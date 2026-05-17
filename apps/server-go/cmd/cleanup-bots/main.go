// Cleanup utility that removes bot games from MongoDB.
//
// Bot games are identified by either player's userId starting with "bot:".
// Bots never write rating rows and don't have user documents, so this only
// deletes from the games collection.
//
// Usage:
//   # Dry run (default) — prints counts only.
//   railway run -- go run ./apps/server-go/cmd/cleanup-bots
//
//   # Actually delete.
//   railway run -- go run ./apps/server-go/cmd/cleanup-bots --execute
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

	filter := bson.M{"$or": []bson.M{
		{"white.userId": bson.M{"$regex": "^bot:"}},
		{"black.userId": bson.M{"$regex": "^bot:"}},
	}}

	fmt.Printf("=== cleanup-bots (execute=%v) ===\n", *execute)

	count, err := db.Collection("games").CountDocuments(ctx, filter)
	if err != nil {
		log.Fatalf("count games: %v", err)
	}
	fmt.Printf("matched games: %d\n", count)

	if count == 0 {
		fmt.Println("nothing to clean up.")
		return
	}

	if !*execute {
		fmt.Println("\n(dry run — pass --execute to perform deletes)")
		return
	}

	res, err := db.Collection("games").DeleteMany(ctx, filter)
	if err != nil {
		log.Fatalf("delete games: %v", err)
	}
	fmt.Printf("deleted games: %d\n", res.DeletedCount)
	fmt.Println("\ndone.")
}
