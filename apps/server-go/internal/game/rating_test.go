package game

import "testing"

func TestRateGameInitialPlayerWins(t *testing.T) {
	white := RatingDoc{Rating: StartingRating, RD: StartingRD}
	black := RatingDoc{Rating: StartingRating, RD: StartingRD}

	rated := RateGame(white, black, ResultWhite)

	if rated.White.Rating != 1362 || rated.Black.Rating != 1038 {
		t.Fatalf("ratings = white %.0f black %.0f, want 1362/1038", rated.White.Rating, rated.Black.Rating)
	}
	if rated.White.RD != 290 || rated.Black.RD != 290 {
		t.Fatalf("RDs = white %.0f black %.0f, want 290/290", rated.White.RD, rated.Black.RD)
	}
}

func TestRateGameDraw(t *testing.T) {
	white := RatingDoc{Rating: StartingRating, RD: StartingRD}
	black := RatingDoc{Rating: StartingRating, RD: StartingRD}

	rated := RateGame(white, black, ResultDraw)

	if rated.White.Rating != StartingRating || rated.Black.Rating != StartingRating {
		t.Fatalf("ratings = white %.0f black %.0f, want 1200/1200", rated.White.Rating, rated.Black.Rating)
	}
	if rated.White.RD != 290 || rated.Black.RD != 290 {
		t.Fatalf("RDs = white %.0f black %.0f, want 290/290", rated.White.RD, rated.Black.RD)
	}
}
