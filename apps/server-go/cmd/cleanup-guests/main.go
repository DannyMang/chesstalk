// Cleanup utility that removes guest-user data from MongoDB.
//
// Usage:
//   # Dry run (default) — prints counts only, no writes.
//   railway run -- go run ./apps/server-go/cmd/cleanup-guests
//
//   # Actually delete.
//   railway run -- go run ./apps/server-go/cmd/cleanup-guests --execute
//
// Flags:
//   --execute            Perform deletes. Without this, only counts are shown.
//   --prefix=<string>    clerkUserId prefix to match (default "guest:").
//                        Use "guest:loadtest-" to target only k6 test users.
//
// Deletes happen in dependency order:
//   1. ratings (referenced by users._id)
//   2. games  (referenced by users._id via white.userId / black.userId)
//   3. users  (the matched docs themselves)
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

func main() {
	execute := flag.Bool("execute", false, "actually delete; default is dry run")
	prefix := flag.String("prefix", "guest:", "clerkUserId prefix to match")
	flag.Parse()

	uri := os.Getenv("MONGODB_URI")
	if uri == "" {
		log.Fatal("MONGODB_URI is required")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	client, err := mongo.Connect(options.Client().ApplyURI(uri))
	if err != nil {
		log.Fatalf("connect: %v", err)
	}
	defer func() { _ = client.Disconnect(context.Background()) }()

	db := client.Database("chesstalk")

	userFilter := bson.M{
		"clerkUserId": bson.M{"$regex": "^" + *prefix},
	}

	fmt.Printf("=== cleanup-guests (prefix=%q, execute=%v) ===\n", *prefix, *execute)

	// Step 1: collect matching user _ids
	cursor, err := db.Collection("users").Find(
		ctx, userFilter, options.Find().SetProjection(bson.M{"_id": 1}),
	)
	if err != nil {
		log.Fatalf("find users: %v", err)
	}
	var users []struct {
		ID string `bson:"_id"`
	}
	if err := cursor.All(ctx, &users); err != nil {
		log.Fatalf("decode users: %v", err)
	}
	ids := make([]string, 0, len(users))
	for _, u := range users {
		ids = append(ids, u.ID)
	}
	fmt.Printf("matched users:   %d\n", len(ids))

	if len(ids) == 0 {
		fmt.Println("nothing to clean up.")
		return
	}

	// Step 2: count downstream rows
	ratingsCount, err := db.Collection("ratings").CountDocuments(
		ctx, bson.M{"userId": bson.M{"$in": ids}},
	)
	if err != nil {
		log.Fatalf("count ratings: %v", err)
	}
	gamesCount, err := db.Collection("games").CountDocuments(
		ctx, bson.M{"$or": []bson.M{
			{"white.userId": bson.M{"$in": ids}},
			{"black.userId": bson.M{"$in": ids}},
		}},
	)
	if err != nil {
		log.Fatalf("count games: %v", err)
	}
	fmt.Printf("matched ratings: %d\n", ratingsCount)
	fmt.Printf("matched games:   %d\n", gamesCount)

	if !*execute {
		fmt.Println("\n(dry run — pass --execute to perform deletes)")
		return
	}

	// Step 3: delete in dependency order
	rDel, err := db.Collection("ratings").DeleteMany(
		ctx, bson.M{"userId": bson.M{"$in": ids}},
	)
	if err != nil {
		log.Fatalf("delete ratings: %v", err)
	}
	fmt.Printf("deleted ratings: %d\n", rDel.DeletedCount)

	gDel, err := db.Collection("games").DeleteMany(
		ctx, bson.M{"$or": []bson.M{
			{"white.userId": bson.M{"$in": ids}},
			{"black.userId": bson.M{"$in": ids}},
		}},
	)
	if err != nil {
		log.Fatalf("delete games: %v", err)
	}
	fmt.Printf("deleted games:   %d\n", gDel.DeletedCount)

	uDel, err := db.Collection("users").DeleteMany(ctx, userFilter)
	if err != nil {
		log.Fatalf("delete users: %v", err)
	}
	fmt.Printf("deleted users:   %d\n", uDel.DeletedCount)

	fmt.Println("\ndone.")
}
