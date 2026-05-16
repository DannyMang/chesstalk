package game

import (
	"regexp"
	"strings"
)

var (
	spaceRE  = regexp.MustCompile(`\s+`)
	squareRE = regexp.MustCompile(`\b([a-h])\s*([1-8])\b`)
)

var wordRewrites = []struct {
	old string
	new string
}{
	{"night", "knight"},
	{"horse", "knight"},
	{"tower", "rook"},
	{"captures", "takes"},
	{"capture", "takes"},
	{"castle king side", "O-O"},
	{"castle kingside", "O-O"},
	{"castles kingside", "O-O"},
	{"short castle", "O-O"},
	{"castle queen side", "O-O-O"},
	{"castle queenside", "O-O-O"},
	{"castles queenside", "O-O-O"},
	{"long castle", "O-O-O"},
	{" to ", " "},
}

var pieceWords = map[string]string{
	"king":   "K",
	"queen":  "Q",
	"rook":   "R",
	"bishop": "B",
	"knight": "N",
}

func NormalizeSpokenMove(raw string) []string {
	normalized := strings.ToLower(strings.TrimSpace(raw))
	normalized = strings.NewReplacer(".", " ", ",", " ", "!", " ", "?", " ").Replace(normalized)
	for _, rewrite := range wordRewrites {
		normalized = strings.ReplaceAll(normalized, rewrite.old, rewrite.new)
	}
	normalized = squareRE.ReplaceAllString(normalized, "$1$2")
	normalized = spaceRE.ReplaceAllString(strings.TrimSpace(normalized), " ")
	if normalized == "" {
		return nil
	}

	candidates := []string{normalized}
	compact := strings.ReplaceAll(normalized, " ", "")
	if compact != normalized {
		candidates = append(candidates, compact)
	}

	parts := strings.Fields(normalized)
	if len(parts) >= 2 {
		if piece, ok := pieceWords[parts[0]]; ok {
			target := parts[len(parts)-1]
			if len(target) == 2 {
				candidates = append(candidates, piece+target)
			}
		}
		if len(parts[0]) == 2 && len(parts[len(parts)-1]) == 2 {
			candidates = append(candidates, parts[0]+parts[len(parts)-1])
		}
	}

	return dedupe(candidates)
}

func dedupe(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}
