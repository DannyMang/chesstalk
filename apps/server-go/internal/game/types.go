package game

import "time"

const (
	ModeEasy      = "easy"
	ModeBlindfold = "blindfold"

	ColorWhite = "white"
	ColorBlack = "black"

	ResultWhite = "white"
	ResultBlack = "black"
	ResultDraw  = "draw"

	TerminationCheckmate            = "checkmate"
	TerminationResignation          = "resignation"
	TerminationTimeout              = "timeout"
	TerminationIllegalStrikes       = "illegal_strikes"
	TerminationStalemate            = "draw_stalemate"
	TerminationThreefoldRepetition  = "draw_threefold"
	TerminationFiftyMoveRule        = "draw_fifty"
	TerminationInsufficientMaterial = "draw_material"
	TerminationAgreedDraw           = "draw_agreed"

	IllegalMoveLimit = 3
	StartingRating   = 1200
	StartingRD       = 350
)

type TimeControl struct {
	InitialSeconds   int `json:"initialSeconds" bson:"initialSeconds"`
	IncrementSeconds int `json:"incrementSeconds" bson:"incrementSeconds"`
}

type PlayerSnapshot struct {
	UserID       string   `json:"userId" bson:"userId"`
	Username     string   `json:"username" bson:"username"`
	RatingBefore float64  `json:"ratingBefore" bson:"ratingBefore"`
	RatingAfter  *float64 `json:"ratingAfter" bson:"ratingAfter"`
}

type OpponentInfo struct {
	UserID   string  `json:"userId"`
	Username string  `json:"username"`
	Rating   float64 `json:"rating"`
}

type MoveRecord struct {
	SAN          string `json:"san" bson:"san"`
	UCI          string `json:"uci" bson:"uci"`
	Raw          string `json:"raw" bson:"raw"`
	MSFromStart  int64  `json:"msFromStart" bson:"msFromStart"`
	WhiteClockMS int64  `json:"whiteClockMs" bson:"whiteClockMs"`
	BlackClockMS int64  `json:"blackClockMs" bson:"blackClockMs"`
}

type GameDoc struct {
	ID           string         `bson:"_id"`
	Mode         string         `bson:"mode"`
	TimeControl  TimeControl    `bson:"timeControl"`
	White        PlayerSnapshot `bson:"white"`
	Black        PlayerSnapshot `bson:"black"`
	Result       *string        `bson:"result"`
	Termination  *string        `bson:"termination"`
	PGN          string         `bson:"pgn"`
	Moves        []MoveRecord   `bson:"moves"`
	IllegalCount map[string]int `bson:"illegalCount"`
	StartedAt    time.Time      `bson:"startedAt"`
	EndedAt      *time.Time     `bson:"endedAt"`
	ExpiresAt    time.Time      `bson:"expiresAt"`
}

type UserDoc struct {
	ID              string       `bson:"_id"`
	ClerkUserID     string       `bson:"clerkUserId"`
	Username        string       `bson:"username"`
	NameChangesUsed int          `bson:"nameChangesUsed"`
	CreatedAt       time.Time    `bson:"createdAt"`
	Settings        UserSettings `bson:"settings"`
}

type UserSettings struct {
	ManualAudio      bool   `bson:"manualAudio"`
	TTSAnnouncements bool   `bson:"ttsAnnouncements"`
	PreferredColor   string `bson:"preferredColor"`
}

type RatingDoc struct {
	ID        string    `bson:"_id"`
	UserID    string    `bson:"userId"`
	Mode      string    `bson:"mode"`
	Rating    float64   `bson:"rating"`
	RD        float64   `bson:"rd"`
	Games     int       `bson:"games"`
	UpdatedAt time.Time `bson:"updatedAt"`
}

func OtherColor(color string) string {
	if color == ColorWhite {
		return ColorBlack
	}
	return ColorWhite
}

func WinnerFromColor(color string) string {
	if color == ColorWhite {
		return ResultWhite
	}
	return ResultBlack
}
