package game

import (
	"testing"
	"time"

	"github.com/notnil/chess"
)

func newVoiceTestActor() *Actor {
	now := time.Now()
	return NewActor(NewActorParams{
		ID:          "voice-test",
		Mode:        ModeEasy,
		TimeControl: TimeControl{InitialSeconds: 300},
		White:       PlayerSnapshot{UserID: "white", Username: "White", RatingBefore: 1200},
		Black:       PlayerSnapshot{UserID: "black", Username: "Black", RatingBefore: 1200},
		Now:         now,
	})
}

func newGameFromFEN(t *testing.T, fen string) *chess.Game {
	t.Helper()
	option, err := chess.FEN(fen)
	if err != nil {
		t.Fatalf("invalid FEN %q: %v", fen, err)
	}
	return chess.NewGame(option)
}

func TestProposeSpokenMoveMatchesLegalMoves(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want string
	}{
		{name: "pawn square", raw: "e4", want: "e4"},
		{name: "spoken number", raw: "e four", want: "e4"},
		{name: "pawn phrase", raw: "pawn to e four", want: "e4"},
		{name: "piece phrase", raw: "knight to f three", want: "Nf3"},
		{name: "piece homophone", raw: "night to f three", want: "Nf3"},
		{name: "piece alias", raw: "horse to f three", want: "Nf3"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			actor := newVoiceTestActor()
			result := actor.ProposeSpokenMove("white", tc.raw, time.Now())
			if !result.OK {
				t.Fatalf("expected %q to move, got reason %q", tc.raw, result.Reason)
			}
			if result.Move.SAN != tc.want {
				t.Fatalf("expected SAN %q, got %q", tc.want, result.Move.SAN)
			}
		})
	}
}

func TestResolveSpokenMoveSpecialPositions(t *testing.T) {
	tests := []struct {
		name string
		fen  string
		raw  string
		want string
	}{
		{
			name: "capture",
			fen:  "rnbqkbnr/pppp1ppp/8/4p3/3P4/8/PPP1PPPP/RNBQKBNR w KQkq e6 0 2",
			raw:  "d takes e five",
			want: "dxe5",
		},
		{
			name: "king side castle",
			fen:  "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1",
			raw:  "castle kingside",
			want: "O-O",
		},
		{
			name: "queen side castle",
			fen:  "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1",
			raw:  "long castle",
			want: "O-O-O",
		},
		{
			name: "spoken king side castle",
			fen:  "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1",
			raw:  "o o",
			want: "O-O",
		},
		{
			name: "spoken queen side castle",
			fen:  "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1",
			raw:  "oh oh oh",
			want: "O-O-O",
		},
		{
			name: "default queen promotion",
			fen:  "4k3/P7/8/8/8/8/8/4K3 w - - 0 1",
			raw:  "a eight",
			want: "a8=Q+",
		},
		{
			name: "explicit underpromotion",
			fen:  "4k3/P7/8/8/8/8/8/4K3 w - - 0 1",
			raw:  "a eight knight",
			want: "a8=N",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			game := newGameFromFEN(t, tc.fen)
			resolution := ResolveSpokenMove(game.Position(), tc.raw)
			if !resolution.Confident {
				t.Fatalf("expected confident resolution for %q, got %+v", tc.raw, resolution)
			}
			if resolution.Label != tc.want {
				t.Fatalf("expected %q, got %q", tc.want, resolution.Label)
			}
		})
	}
}

func TestResolveSpokenMoveAmbiguousRatherThanGuessing(t *testing.T) {
	game := newGameFromFEN(t, "4k3/8/8/8/8/8/2N3N1/4K3 w - - 0 1")
	resolution := ResolveSpokenMove(game.Position(), "knight to e three")
	if !resolution.Ambiguous {
		t.Fatalf("expected ambiguous result, got %+v", resolution)
	}
	if len(resolution.CandidateLabels) != 2 {
		t.Fatalf("expected 2 candidate labels, got %v", resolution.CandidateLabels)
	}
}

func TestProposeSpokenMoveAmbiguousDoesNotChargeIllegalStrike(t *testing.T) {
	option, err := chess.FEN("4k3/8/8/8/8/8/2N3N1/4K3 w - - 0 1")
	if err != nil {
		t.Fatalf("invalid FEN: %v", err)
	}
	actor := NewActor(NewActorParams{
		ID:          "ambiguous-test",
		Mode:        ModeEasy,
		TimeControl: TimeControl{InitialSeconds: 300},
		White:       PlayerSnapshot{UserID: "white", Username: "White", RatingBefore: 1200},
		Black:       PlayerSnapshot{UserID: "black", Username: "Black", RatingBefore: 1200},
		Now:         time.Now(),
	})
	actor.chessGame = chess.NewGame(option)

	result := actor.ProposeSpokenMove("white", "knight to e three", time.Now())
	if !result.Ambiguous {
		t.Fatalf("expected ambiguous result, got %+v", result)
	}
	if result.IllegalCount != 0 {
		t.Fatalf("expected no illegal strike, got %d", result.IllegalCount)
	}
	if len(result.CandidateLabels) != 2 {
		t.Fatalf("expected candidates, got %v", result.CandidateLabels)
	}
}

func TestKeytermsForPositionIncludesNaturalMovePhrases(t *testing.T) {
	actor := newVoiceTestActor()
	terms := actor.LegalMoveKeyterms()
	assertContains(t, terms, "Nf3")
	assertContains(t, terms, "g1f3")
	assertContains(t, terms, "knight to f3")
	assertContains(t, terms, "knight to foxtrot three")
	assertContains(t, terms, "e4")
	assertContains(t, terms, "echo four")
}

func TestProposeSpokenMoveIgnoresNonChessSpeech(t *testing.T) {
	actor := newVoiceTestActor()
	result := actor.ProposeSpokenMove("white", "hi how are you", time.Now())
	if result.OK {
		t.Fatal("expected non-chess speech not to move")
	}
	if result.Reason != "No chess move heard" {
		t.Fatalf("expected no-move reason, got %q", result.Reason)
	}
	if result.IllegalCount != 0 {
		t.Fatalf("expected no illegal strike, got %d", result.IllegalCount)
	}
}

func TestProposeSpokenMoveChargesChessIntentThatIsIllegal(t *testing.T) {
	actor := newVoiceTestActor()
	result := actor.ProposeSpokenMove("white", "king to e2", time.Now())
	if result.OK {
		t.Fatal("expected illegal king move not to move")
	}
	if result.Reason != "Illegal or unparseable move" {
		t.Fatalf("expected illegal reason, got %q", result.Reason)
	}
	if result.IllegalCount != 1 {
		t.Fatalf("expected one illegal strike, got %d", result.IllegalCount)
	}
}

func assertContains(t *testing.T, values []string, want string) {
	t.Helper()
	for _, value := range values {
		if value == want {
			return
		}
	}
	t.Fatalf("expected %q in %v", want, values)
}
