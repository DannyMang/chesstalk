package protocol

import (
	"strings"
	"testing"
)

func TestValidateGameMessageAcceptsPing(t *testing.T) {
	msg, err := ValidateGameMessage([]byte(`{"type":"ping","t":123}`))
	if err != nil {
		t.Fatalf("expected ping to validate: %v", err)
	}
	if msg.Type != "ping" || msg.T != 123 {
		t.Fatalf("unexpected ping: %+v", msg)
	}
}

func TestValidateGameMessageRejectsUnknownFields(t *testing.T) {
	_, err := ValidateGameMessage([]byte(`{"type":"queue:leave","extra":true}`))
	if err == nil {
		t.Fatal("expected unknown field error")
	}
}

func TestValidateGameMessageRejectsInvalidTimeControl(t *testing.T) {
	_, err := ValidateGameMessage([]byte(`{"type":"queue:join","mode":"easy","timeControl":{"initialSeconds":1,"incrementSeconds":99}}`))
	if err == nil {
		t.Fatal("expected invalid time control")
	}
}

func TestValidateGameMessageRejectsBadBotStrength(t *testing.T) {
	_, err := ValidateGameMessage([]byte(`{"type":"bot:start","mode":"easy","timeControl":{"initialSeconds":300,"incrementSeconds":0},"strength":99}`))
	if err == nil {
		t.Fatal("expected invalid strength")
	}
}

func TestValidateGameMessageTrimsMoveText(t *testing.T) {
	msg, err := ValidateGameMessage([]byte(`{"type":"move:propose","gameId":"game_123","raw":"  knight to f3  "}`))
	if err != nil {
		t.Fatalf("expected move to validate: %v", err)
	}
	if msg.Raw != "knight to f3" {
		t.Fatalf("expected trimmed raw, got %q", msg.Raw)
	}
}

func TestValidateGameMessageAcceptsGameResume(t *testing.T) {
	msg, err := ValidateGameMessage([]byte(`{"type":"game:resume","gameId":"game_123"}`))
	if err != nil {
		t.Fatalf("expected game resume to validate: %v", err)
	}
	if msg.Type != "game:resume" || msg.GameID != "game_123" {
		t.Fatalf("unexpected resume message: %+v", msg)
	}
}

func TestValidateGameMessageRejectsOversizedPayload(t *testing.T) {
	_, err := ValidateGameMessage([]byte(strings.Repeat("x", MaxGameJSONBytes+1)))
	if err == nil {
		t.Fatal("expected oversized payload error")
	}
}

func TestValidateAudioMessageAcceptsTranscript(t *testing.T) {
	msg, err := ValidateAudioMessage([]byte(`{"type":"audio:transcript","gameId":"game_123","text":" e4 "}`))
	if err != nil {
		t.Fatalf("expected transcript to validate: %v", err)
	}
	if msg.Text != "e4" {
		t.Fatalf("expected trimmed text, got %q", msg.Text)
	}
}

func TestValidateAudioMessageRejectsLongTranscript(t *testing.T) {
	payload := `{"type":"audio:transcript","gameId":"game_123","text":"` + strings.Repeat("a", 501) + `"}`
	_, err := ValidateAudioMessage([]byte(payload))
	if err == nil {
		t.Fatal("expected long transcript error")
	}
}
