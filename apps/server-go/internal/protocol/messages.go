package protocol

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"regexp"
	"strings"
)

const (
	MaxGameJSONBytes   = 4 * 1024
	MaxAudioJSONBytes  = 8 * 1024
	MaxAudioFrameBytes = 64 * 1024
)

var (
	gameIDRE   = regexp.MustCompile(`^[a-zA-Z0-9:_-]{1,80}$`)
	inviteIDRE = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,80}$`)
)

type TimeControl struct {
	InitialSeconds   int `json:"initialSeconds"`
	IncrementSeconds int `json:"incrementSeconds"`
}

type GameMessage struct {
	Type        string
	Mode        string
	TimeControl TimeControl
	Side        string
	Strength    int
	InviteID    string
	GameID      string
	Raw         string
	T           float64
}

type AudioMessage struct {
	Type   string
	GameID string
	Text   string
}

type wireEnvelope struct {
	Type string `json:"type"`
}

func ValidateGameMessage(data []byte) (GameMessage, error) {
	if len(data) > MaxGameJSONBytes {
		return GameMessage{}, errors.New("game message is too large")
	}

	var envelope wireEnvelope
	if err := json.Unmarshal(data, &envelope); err != nil {
		return GameMessage{}, errors.New("invalid JSON")
	}

	switch envelope.Type {
	case "queue:join":
		var msg struct {
			Type        string      `json:"type"`
			Mode        string      `json:"mode"`
			TimeControl TimeControl `json:"timeControl"`
		}
		if err := decodeStrict(data, &msg); err != nil {
			return GameMessage{}, err
		}
		if !validMode(msg.Mode) || !validTimeControl(msg.TimeControl) {
			return GameMessage{}, errors.New("invalid queue settings")
		}
		return GameMessage{Type: msg.Type, Mode: msg.Mode, TimeControl: msg.TimeControl}, nil
	case "queue:leave":
		var msg struct {
			Type string `json:"type"`
		}
		if err := decodeStrict(data, &msg); err != nil {
			return GameMessage{}, err
		}
		return GameMessage{Type: msg.Type}, nil
	case "bot:start":
		var msg struct {
			Type        string      `json:"type"`
			Mode        string      `json:"mode"`
			TimeControl TimeControl `json:"timeControl"`
			Side        string      `json:"side,omitempty"`
			Strength    *int        `json:"strength,omitempty"`
		}
		if err := decodeStrict(data, &msg); err != nil {
			return GameMessage{}, err
		}
		if !validMode(msg.Mode) || !validTimeControl(msg.TimeControl) {
			return GameMessage{}, errors.New("invalid bot settings")
		}
		if msg.Side != "" && msg.Side != "white" && msg.Side != "black" {
			return GameMessage{}, errors.New("invalid bot side")
		}
		strength := 5
		if msg.Strength != nil {
			strength = *msg.Strength
		}
		if strength < 0 || strength > 20 {
			return GameMessage{}, errors.New("bot strength must be 0-20")
		}
		return GameMessage{
			Type:        msg.Type,
			Mode:        msg.Mode,
			TimeControl: msg.TimeControl,
			Side:        msg.Side,
			Strength:    strength,
		}, nil
	case "invite:create":
		var msg struct {
			Type        string      `json:"type"`
			Mode        string      `json:"mode"`
			TimeControl TimeControl `json:"timeControl"`
		}
		if err := decodeStrict(data, &msg); err != nil {
			return GameMessage{}, err
		}
		if !validMode(msg.Mode) || !validTimeControl(msg.TimeControl) {
			return GameMessage{}, errors.New("invalid invite settings")
		}
		return GameMessage{Type: msg.Type, Mode: msg.Mode, TimeControl: msg.TimeControl}, nil
	case "invite:join":
		var msg struct {
			Type     string `json:"type"`
			InviteID string `json:"inviteId"`
		}
		if err := decodeStrict(data, &msg); err != nil {
			return GameMessage{}, err
		}
		inviteID := strings.TrimSpace(msg.InviteID)
		if !inviteIDRE.MatchString(inviteID) {
			return GameMessage{}, errors.New("invalid invite ID")
		}
		return GameMessage{Type: msg.Type, InviteID: inviteID}, nil
	case "game:resign", "game:offerDraw", "game:acceptDraw":
		var msg struct {
			Type   string `json:"type"`
			GameID string `json:"gameId"`
		}
		if err := decodeStrict(data, &msg); err != nil {
			return GameMessage{}, err
		}
		gameID := strings.TrimSpace(msg.GameID)
		if !gameIDRE.MatchString(gameID) {
			return GameMessage{}, errors.New("invalid game ID")
		}
		return GameMessage{Type: msg.Type, GameID: gameID}, nil
	case "move:propose":
		var msg struct {
			Type   string `json:"type"`
			GameID string `json:"gameId"`
			Raw    string `json:"raw"`
		}
		if err := decodeStrict(data, &msg); err != nil {
			return GameMessage{}, err
		}
		gameID := strings.TrimSpace(msg.GameID)
		raw := strings.TrimSpace(msg.Raw)
		if !gameIDRE.MatchString(gameID) || len(raw) == 0 || len(raw) > 80 {
			return GameMessage{}, errors.New("invalid move proposal")
		}
		return GameMessage{Type: msg.Type, GameID: gameID, Raw: raw}, nil
	case "ping":
		var msg struct {
			Type string  `json:"type"`
			T    float64 `json:"t"`
		}
		if err := decodeStrict(data, &msg); err != nil {
			return GameMessage{}, err
		}
		if math.IsNaN(msg.T) || math.IsInf(msg.T, 0) || msg.T < 0 {
			return GameMessage{}, errors.New("invalid ping timestamp")
		}
		return GameMessage{Type: msg.Type, T: msg.T}, nil
	default:
		return GameMessage{}, fmt.Errorf("unsupported game message type %q", envelope.Type)
	}
}

func ValidateAudioMessage(data []byte) (AudioMessage, error) {
	if len(data) > MaxAudioJSONBytes {
		return AudioMessage{}, errors.New("audio message is too large")
	}

	var envelope wireEnvelope
	if err := json.Unmarshal(data, &envelope); err != nil {
		return AudioMessage{}, errors.New("invalid JSON")
	}

	switch envelope.Type {
	case "audio:start", "audio:stop":
		var msg struct {
			Type   string `json:"type"`
			GameID string `json:"gameId"`
		}
		if err := decodeStrict(data, &msg); err != nil {
			return AudioMessage{}, err
		}
		gameID := strings.TrimSpace(msg.GameID)
		if !gameIDRE.MatchString(gameID) {
			return AudioMessage{}, errors.New("invalid game ID")
		}
		return AudioMessage{Type: msg.Type, GameID: gameID}, nil
	case "audio:transcript":
		var msg struct {
			Type   string `json:"type"`
			GameID string `json:"gameId"`
			Text   string `json:"text"`
		}
		if err := decodeStrict(data, &msg); err != nil {
			return AudioMessage{}, err
		}
		gameID := strings.TrimSpace(msg.GameID)
		text := strings.TrimSpace(msg.Text)
		if !gameIDRE.MatchString(gameID) || len(text) == 0 || len(text) > 500 {
			return AudioMessage{}, errors.New("invalid transcript")
		}
		return AudioMessage{Type: msg.Type, GameID: gameID, Text: text}, nil
	default:
		return AudioMessage{}, fmt.Errorf("unsupported audio message type %q", envelope.Type)
	}
}

func decodeStrict(data []byte, target any) error {
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if decoder.More() {
		return errors.New("message has trailing JSON")
	}
	return nil
}

func validMode(mode string) bool {
	return mode == "easy" || mode == "blindfold"
}

func validTimeControl(tc TimeControl) bool {
	return (tc.InitialSeconds == 300 || tc.InitialSeconds == 600) && tc.IncrementSeconds == 0
}
