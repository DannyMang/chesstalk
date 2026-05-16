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

func (s *MongoStore) PersistFinishedGame(ctx context.Context, actor *game.Actor) error {
	if s == nil {
		return nil
	}
	doc := actor.Snapshot()
	if doc.Result == nil || doc.Termination == nil || doc.EndedAt == nil {
		return fmt.Errorf("game %s is not finished", doc.ID)
	}
	doc.ExpiresAt = doc.EndedAt.Add(49 * 24 * time.Hour)
	_, err := s.db.Collection("games").InsertOne(ctx, doc)
	return err
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
