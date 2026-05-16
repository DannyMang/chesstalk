package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/DannyMang/chesstalk/apps/server-go/internal/game"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

const dbName = "chesstalk"

type MongoStore struct {
	client *mongo.Client
	db     *mongo.Database
}

func Connect(ctx context.Context, uri string) (*MongoStore, error) {
	if uri == "" {
		return nil, errors.New("MONGODB_URI is required")
	}
	client, err := mongo.Connect(options.Client().ApplyURI(uri))
	if err != nil {
		return nil, err
	}
	if err := client.Ping(ctx, nil); err != nil {
		_ = client.Disconnect(ctx)
		return nil, err
	}
	return &MongoStore{client: client, db: client.Database(dbName)}, nil
}

func (s *MongoStore) Disconnect(ctx context.Context) error {
	if s == nil || s.client == nil {
		return nil
	}
	return s.client.Disconnect(ctx)
}

func (s *MongoStore) EnsureIndexes(ctx context.Context) error {
	if s == nil {
		return nil
	}
	_, err := s.db.Collection("users").Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys:    bson.D{{Key: "clerkUserId", Value: 1}},
		Options: options.Index().SetUnique(true).SetName("users_clerkUserId_unique"),
	})
	if err != nil {
		return err
	}
	_, err = s.db.Collection("users").Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys:    bson.D{{Key: "username", Value: 1}},
		Options: options.Index().SetUnique(true).SetName("users_username_unique"),
	})
	if err != nil {
		return err
	}
	_, err = s.db.Collection("ratings").Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys:    bson.D{{Key: "userId", Value: 1}, {Key: "mode", Value: 1}},
		Options: options.Index().SetUnique(true).SetName("ratings_userId_mode_unique"),
	})
	if err != nil {
		return err
	}
	_, err = s.db.Collection("games").Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys:    bson.D{{Key: "expiresAt", Value: 1}},
		Options: options.Index().SetExpireAfterSeconds(0).SetName("games_expiresAt_ttl"),
	})
	if err != nil {
		return err
	}
	_, err = s.db.Collection("games").Indexes().CreateMany(ctx, []mongo.IndexModel{
		{Keys: bson.D{{Key: "white.userId", Value: 1}, {Key: "endedAt", Value: -1}}, Options: options.Index().SetName("games_whiteUser_endedAt")},
		{Keys: bson.D{{Key: "black.userId", Value: 1}, {Key: "endedAt", Value: -1}}, Options: options.Index().SetName("games_blackUser_endedAt")},
	})
	return err
}

func (s *MongoStore) EnsureUser(ctx context.Context, clerkUserID string, fallbackUsername string) (game.UserDoc, error) {
	if s == nil {
		now := time.Now()
		return game.UserDoc{
			ID:              clerkUserID,
			ClerkUserID:     clerkUserID,
			Username:        fallbackUsername,
			NameChangesUsed: 0,
			CreatedAt:       now,
			Settings:        defaultSettings(),
		}, nil
	}

	users := s.db.Collection("users")
	var existing game.UserDoc
	err := users.FindOne(ctx, bson.M{"clerkUserId": clerkUserID}).Decode(&existing)
	if err == nil {
		return existing, nil
	}
	if !errors.Is(err, mongo.ErrNoDocuments) {
		return game.UserDoc{}, err
	}

	now := time.Now()
	row := game.UserDoc{
		ID:              randomID(),
		ClerkUserID:     clerkUserID,
		Username:        fallbackUsername,
		NameChangesUsed: 0,
		CreatedAt:       now,
		Settings:        defaultSettings(),
	}
	if _, err := users.InsertOne(ctx, row); err != nil {
		err = users.FindOne(ctx, bson.M{"clerkUserId": clerkUserID}).Decode(&existing)
		if err == nil {
			return existing, nil
		}
		return game.UserDoc{}, err
	}

	if err := s.EnsureRatingRow(ctx, row.ID, game.ModeEasy); err != nil {
		return game.UserDoc{}, err
	}
	if err := s.EnsureRatingRow(ctx, row.ID, game.ModeBlindfold); err != nil {
		return game.UserDoc{}, err
	}
	return row, nil
}

func (s *MongoStore) EnsureRatingRow(ctx context.Context, userID string, mode string) error {
	if s == nil {
		return nil
	}
	_, err := s.db.Collection("ratings").UpdateOne(
		ctx,
		bson.M{"userId": userID, "mode": mode},
		bson.M{"$setOnInsert": game.RatingDoc{
			ID:        randomID(),
			UserID:    userID,
			Mode:      mode,
			Rating:    game.StartingRating,
			RD:        game.StartingRD,
			Games:     0,
			UpdatedAt: time.Now(),
		}},
		options.UpdateOne().SetUpsert(true),
	)
	return err
}

func (s *MongoStore) RatingFor(ctx context.Context, userID string, mode string) float64 {
	if s == nil {
		return game.StartingRating
	}
	var row game.RatingDoc
	if err := s.db.Collection("ratings").FindOne(ctx, bson.M{"userId": userID, "mode": mode}).Decode(&row); err != nil {
		return game.StartingRating
	}
	return row.Rating
}

func (s *MongoStore) PersistFinishedGame(ctx context.Context, actor *game.Actor) (game.GameDoc, error) {
	doc := actor.Snapshot()
	if doc.Result == nil || doc.Termination == nil || doc.EndedAt == nil {
		return doc, fmt.Errorf("game %s is not finished", doc.ID)
	}
	if s == nil {
		ratedDoc, _ := rateFinishedGame(doc, fallbackRatingRow(doc.White), fallbackRatingRow(doc.Black))
		return ratedDoc, nil
	}
	doc.ExpiresAt = doc.EndedAt.Add(49 * 24 * time.Hour)
	whiteRating, err := s.ratingRowForPlayer(ctx, doc.White, doc.Mode)
	if err != nil {
		return doc, err
	}
	blackRating, err := s.ratingRowForPlayer(ctx, doc.Black, doc.Mode)
	if err != nil {
		return doc, err
	}
	var rated game.RatedGame
	doc, rated = rateFinishedGame(doc, whiteRating, blackRating)
	if err := s.persistRatingUpdates(ctx, doc, rated); err != nil {
		return doc, err
	}
	_, err = s.db.Collection("games").InsertOne(ctx, doc)
	return doc, err
}

func rateFinishedGame(doc game.GameDoc, whiteRating game.RatingDoc, blackRating game.RatingDoc) (game.GameDoc, game.RatedGame) {
	if doc.Result == nil {
		return doc, game.RatedGame{}
	}
	rated := game.RateGame(whiteRating, blackRating, *doc.Result)
	doc.White.RatingAfter = floatPtr(rated.White.Rating)
	doc.Black.RatingAfter = floatPtr(rated.Black.Rating)
	return doc, rated
}

func (s *MongoStore) ratingRowForPlayer(ctx context.Context, player game.PlayerSnapshot, mode string) (game.RatingDoc, error) {
	if !isPersistedUser(player.UserID) {
		return fallbackRatingRow(player), nil
	}
	if err := s.EnsureRatingRow(ctx, player.UserID, mode); err != nil {
		return game.RatingDoc{}, err
	}
	var row game.RatingDoc
	if err := s.db.Collection("ratings").FindOne(ctx, bson.M{"userId": player.UserID, "mode": mode}).Decode(&row); err != nil {
		return game.RatingDoc{}, err
	}
	return row, nil
}

func fallbackRatingRow(player game.PlayerSnapshot) game.RatingDoc {
	return game.RatingDoc{
		UserID: player.UserID,
		Rating: player.RatingBefore,
		RD:     game.StartingRD,
	}
}

func (s *MongoStore) persistRatingUpdates(ctx context.Context, doc game.GameDoc, rated game.RatedGame) error {
	if doc.White.RatingAfter != nil && isPersistedUser(doc.White.UserID) {
		if err := s.updateRating(ctx, doc.White.UserID, doc.Mode, rated.White); err != nil {
			return err
		}
	}
	if doc.Black.RatingAfter != nil && isPersistedUser(doc.Black.UserID) {
		if err := s.updateRating(ctx, doc.Black.UserID, doc.Mode, rated.Black); err != nil {
			return err
		}
	}
	return nil
}

func (s *MongoStore) updateRating(ctx context.Context, userID string, mode string, rating game.RatingUpdate) error {
	_, err := s.db.Collection("ratings").UpdateOne(
		ctx,
		bson.M{"userId": userID, "mode": mode},
		bson.M{
			"$set": bson.M{
				"rating":    rating.Rating,
				"rd":        rating.RD,
				"updatedAt": time.Now(),
			},
			"$inc": bson.M{"games": 1},
		},
	)
	return err
}

func isPersistedUser(userID string) bool {
	return userID != "" && len(userID) >= 4 && userID[:4] != "bot:"
}

func floatPtr(value float64) *float64 {
	return &value
}

func defaultSettings() game.UserSettings {
	return game.UserSettings{
		ManualAudio:      false,
		TTSAnnouncements: true,
		PreferredColor:   "random",
	}
}

func randomID() string {
	id := bson.NewObjectID()
	return id.Hex()
}
