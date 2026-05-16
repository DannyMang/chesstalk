package game

import (
	"regexp"
	"sort"
	"strings"

	"github.com/notnil/chess"
)

var (
	wsRE     = regexp.MustCompile(`\s+`)
	sanRE    = regexp.MustCompile(`^([kqrbn]?)x?([a-h])([1-8])$`)
	squareRE = regexp.MustCompile(`^([a-h])([1-8])$`)
)

var pieceLexicon = map[string]chess.PieceType{
	"king": chess.King, "kings": chess.King,
	"queen": chess.Queen, "queens": chess.Queen,
	"rook": chess.Rook, "rooks": chess.Rook, "tower": chess.Rook,
	"bishop": chess.Bishop, "bishops": chess.Bishop,
	"knight": chess.Knight, "knights": chess.Knight, "night": chess.Knight, "nite": chess.Knight, "horse": chess.Knight,
	"pawn": chess.Pawn, "pawns": chess.Pawn,
}

var fileLexicon = map[string]chess.File{
	"a": chess.FileA, "ay": chess.FileA, "alpha": chess.FileA,
	"b": chess.FileB, "be": chess.FileB, "bee": chess.FileB, "bravo": chess.FileB,
	"c": chess.FileC, "see": chess.FileC, "sea": chess.FileC, "charlie": chess.FileC,
	"d": chess.FileD, "dee": chess.FileD, "delta": chess.FileD,
	"e": chess.FileE, "ee": chess.FileE, "echo": chess.FileE,
	"f": chess.FileF, "ef": chess.FileF, "eff": chess.FileF, "foxtrot": chess.FileF,
	"g": chess.FileG, "gee": chess.FileG, "golf": chess.FileG,
	"h": chess.FileH, "aitch": chess.FileH, "aych": chess.FileH, "hotel": chess.FileH,
}

var rankLexicon = map[string]chess.Rank{
	"1": chess.Rank1, "one": chess.Rank1, "won": chess.Rank1,
	"2": chess.Rank2, "two": chess.Rank2, "too": chess.Rank2,
	"3": chess.Rank3, "three": chess.Rank3, "tree": chess.Rank3,
	"4": chess.Rank4, "four": chess.Rank4, "for": chess.Rank4, "fore": chess.Rank4,
	"5": chess.Rank5, "five": chess.Rank5,
	"6": chess.Rank6, "six": chess.Rank6,
	"7": chess.Rank7, "seven": chess.Rank7,
	"8": chess.Rank8, "eight": chess.Rank8, "ate": chess.Rank8,
}

var captureWords = map[string]struct{}{
	"takes": {}, "take": {}, "capture": {}, "captures": {}, "x": {},
}

var fillerWords = map[string]struct{}{
	"an": {}, "the": {}, "to": {}, "on": {}, "at": {}, "move": {}, "please": {}, "uh": {}, "um": {},
}

var natoFile = [8]string{
	"alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel",
}

var rankWord = [8]string{
	"one", "two", "three", "four", "five", "six", "seven", "eight",
}

var baseChessVocabulary = []string{
	"check", "checkmate", "mate", "takes", "captures", "capture",
	"castle", "castles", "kingside", "queenside", "short castle", "long castle",
	"promote", "promotes", "promotion", "king", "queen", "rook", "bishop", "knight", "pawn",
	"alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel",
}

type tokenKind int

const (
	tkUnknown tokenKind = iota
	tkPiece
	tkFile
	tkRank
	tkCapture
	tkCastle
	tkSideKing
	tkSideQueen
	tkPromote
)

type voiceToken struct {
	kind tokenKind
	pt   chess.PieceType
	file chess.File
	rank chess.Rank
}

type moveIntent struct {
	piece   chess.PieceType
	srcFile chess.File
	srcRank chess.Rank
	hasSF   bool
	hasSR   bool
	dstFile chess.File
	dstRank chess.Rank
	hasDF   bool
	hasDR   bool
	capture bool
	promo   chess.PieceType
	castle  int
}

func spokenMoveMatch(position *chess.Position, raw string) (*chess.Move, bool, string) {
	res := ResolveSpokenMove(position, raw)
	if res.Confident && res.Move != nil {
		return res.Move, true, res.Label
	}
	return nil, false, ""
}

type SpokenResolution struct {
	Move            *chess.Move
	Label           string
	Confident       bool
	Ambiguous       bool
	Candidates      []*chess.Move
	CandidateLabels []string
}

func ResolveSpokenMove(position *chess.Position, raw string) SpokenResolution {
	tokens := tokenizeVoice(raw)
	if len(tokens) == 0 {
		return SpokenResolution{}
	}
	intent := parseVoiceIntent(tokens)
	var matches []*chess.Move
	for _, move := range position.ValidMoves() {
		if moveFitsIntent(position, move, intent) {
			matches = append(matches, move)
		}
	}
	if len(matches) > 1 && intent.piece == chess.NoPieceType && intent.castle == 0 {
		pawns := matches[:0]
		for _, move := range matches {
			if position.Board().Piece(move.S1()).Type() == chess.Pawn {
				pawns = append(pawns, move)
			}
		}
		if len(pawns) > 0 {
			matches = pawns
		}
	}
	if len(matches) > 1 && intent.promo == chess.NoPieceType {
		queens := matches[:0]
		promotions := 0
		for _, move := range matches {
			if move.Promo() != chess.NoPieceType {
				promotions++
				if move.Promo() == chess.Queen {
					queens = append(queens, move)
				}
			}
		}
		if promotions == len(matches) && len(queens) == 1 {
			matches = queens
		}
	}
	switch len(matches) {
	case 0:
		return SpokenResolution{}
	case 1:
		label := chess.AlgebraicNotation{}.Encode(position, matches[0])
		return SpokenResolution{Move: matches[0], Label: label, Confident: true}
	default:
		labels := make([]string, 0, len(matches))
		for _, move := range matches {
			labels = append(labels, chess.AlgebraicNotation{}.Encode(position, move))
		}
		return SpokenResolution{Ambiguous: true, Candidates: matches, CandidateLabels: labels}
	}
}

func NormalizeSpokenMove(raw string) []string {
	tokens := tokenizeVoice(raw)
	if len(tokens) == 0 {
		return nil
	}
	intent := parseVoiceIntent(tokens)
	var out []string
	if intent.castle == 1 {
		out = append(out, "O-O")
	}
	if intent.castle == 2 {
		out = append(out, "O-O-O")
	}
	if intent.hasDF && intent.hasDR {
		dst := intent.dstFile.String() + intent.dstRank.String()
		if intent.piece != chess.NoPieceType && intent.piece != chess.Pawn {
			out = append(out, pieceLetter(intent.piece)+dst)
		}
		out = append(out, dst)
		if intent.hasSF {
			out = append(out, intent.srcFile.String()+dst)
		}
	}
	return dedupeStrings(out)
}

func LooksLikeChessIntent(raw string) bool {
	for _, token := range tokenizeVoice(raw) {
		switch token.kind {
		case tkPiece, tkFile, tkRank, tkCapture, tkCastle, tkSideKing, tkSideQueen, tkPromote:
			return true
		}
	}
	return false
}

func LooksLikeCompleteMoveIntent(raw string) bool {
	tokens := tokenizeVoice(raw)
	if len(tokens) == 0 {
		return false
	}
	intent := parseVoiceIntent(tokens)
	if intent.castle != 0 {
		return true
	}
	return intent.hasDF && intent.hasDR
}

func KeytermsForPosition(position *chess.Position) []string {
	terms := make(map[string]struct{})
	add := func(value string) {
		value = strings.TrimSpace(value)
		if value != "" {
			terms[value] = struct{}{}
		}
	}
	for _, value := range baseChessVocabulary {
		add(value)
	}
	for _, move := range position.ValidMoves() {
		for _, value := range keytermsForMove(position, move) {
			add(value)
		}
	}
	out := make([]string, 0, len(terms))
	for value := range terms {
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}

func tokenizeVoice(raw string) []voiceToken {
	normalized := normalizeVoiceText(raw)
	if normalized == "" {
		return nil
	}
	parts := preSplitVoice(strings.Fields(normalized))
	tokens := make([]voiceToken, 0, len(parts))
	for _, part := range parts {
		token := classifyVoiceToken(part)
		if token.kind != tkUnknown {
			tokens = append(tokens, token)
		}
	}
	return tokens
}

func normalizeVoiceText(raw string) string {
	s := strings.ToLower(strings.TrimSpace(raw))
	s = strings.NewReplacer(
		"0-0-0", " o o o ",
		"0-0", " o o ",
		"o-o-o", " o o o ",
		"o-o", " o o ",
		".", " ", ",", " ", "!", " ", "?", " ", "-", " ", "_", " ", "=", " equals ",
	).Replace(s)
	return strings.TrimSpace(wsRE.ReplaceAllString(s, " "))
}

func preSplitVoice(parts []string) []string {
	out := make([]string, 0, len(parts)*2)
	for i := 0; i < len(parts); i++ {
		part := parts[i]
		if (part == "o" || part == "oh" || part == "0") && i+1 < len(parts) && (parts[i+1] == "o" || parts[i+1] == "oh" || parts[i+1] == "0") {
			if i+2 < len(parts) && (parts[i+2] == "o" || parts[i+2] == "oh" || parts[i+2] == "0") {
				out = append(out, "castle", "queenside")
				i += 2
				continue
			}
			out = append(out, "castle", "kingside")
			i++
			continue
		}
		switch part {
		case "oo", "ohoh", "0-0":
			out = append(out, "castle", "kingside")
			continue
		case "ooo", "ohohoh", "0-0-0":
			out = append(out, "castle", "queenside")
			continue
		}
		if match := sanRE.FindStringSubmatch(part); match != nil {
			if match[1] != "" {
				out = append(out, match[1])
			}
			out = append(out, match[2], match[3])
			continue
		}
		if match := squareRE.FindStringSubmatch(part); match != nil {
			out = append(out, match[1], match[2])
			continue
		}
		out = append(out, part)
	}
	return out
}

func classifyVoiceToken(raw string) voiceToken {
	if _, ok := fillerWords[raw]; ok {
		return voiceToken{}
	}
	switch raw {
	case "castle", "castles", "castling":
		return voiceToken{kind: tkCastle}
	case "kingside", "short":
		return voiceToken{kind: tkSideKing}
	case "queenside", "long":
		return voiceToken{kind: tkSideQueen}
	case "promote", "promotion", "promotes", "equals", "into":
		return voiceToken{kind: tkPromote}
	}
	if _, ok := captureWords[raw]; ok {
		return voiceToken{kind: tkCapture}
	}
	if pt, ok := pieceLexicon[raw]; ok {
		return voiceToken{kind: tkPiece, pt: pt}
	}
	if f, ok := fileLexicon[raw]; ok {
		return voiceToken{kind: tkFile, file: f}
	}
	if r, ok := rankLexicon[raw]; ok {
		return voiceToken{kind: tkRank, rank: r}
	}
	if pt, ok := pieceKeyIndex[metaphoneLite(raw)]; ok {
		return voiceToken{kind: tkPiece, pt: pt}
	}
	return voiceToken{}
}

func parseVoiceIntent(tokens []voiceToken) moveIntent {
	intent := moveIntent{piece: chess.NoPieceType, promo: chess.NoPieceType}
	for _, token := range tokens {
		if token.kind == tkCastle {
			intent.castle = 1
			for _, side := range tokens {
				if side.kind == tkSideQueen {
					intent.castle = 2
				}
			}
			return intent
		}
	}

	type parsedSquare struct {
		file chess.File
		rank chess.Rank
		hasF bool
		hasR bool
	}
	var squares []parsedSquare
	var pendingFile chess.File
	hasPendingFile := false
	sawDestination := false
	promoteNext := false

	flushFile := func() {
		if hasPendingFile {
			squares = append(squares, parsedSquare{file: pendingFile, hasF: true})
			hasPendingFile = false
		}
	}

	for _, token := range tokens {
		switch token.kind {
		case tkPiece:
			if promoteNext || sawDestination {
				intent.promo = token.pt
				promoteNext = false
			} else if intent.piece == chess.NoPieceType {
				intent.piece = token.pt
			}
		case tkCapture:
			intent.capture = true
		case tkPromote:
			promoteNext = true
			sawDestination = true
		case tkFile:
			flushFile()
			pendingFile = token.file
			hasPendingFile = true
		case tkRank:
			if hasPendingFile {
				squares = append(squares, parsedSquare{file: pendingFile, rank: token.rank, hasF: true, hasR: true})
				hasPendingFile = false
				sawDestination = true
			} else {
				squares = append(squares, parsedSquare{rank: token.rank, hasR: true})
			}
		}
	}
	flushFile()
	if len(squares) == 0 {
		return intent
	}

	dstIdx := -1
	for i := len(squares) - 1; i >= 0; i-- {
		if squares[i].hasF && squares[i].hasR {
			dstIdx = i
			break
		}
	}
	if dstIdx == -1 {
		dstIdx = len(squares) - 1
	}
	dst := squares[dstIdx]
	intent.dstFile, intent.hasDF = dst.file, dst.hasF
	intent.dstRank, intent.hasDR = dst.rank, dst.hasR
	for i := 0; i < dstIdx; i++ {
		if squares[i].hasF {
			intent.srcFile, intent.hasSF = squares[i].file, true
		}
		if squares[i].hasR {
			intent.srcRank, intent.hasSR = squares[i].rank, true
		}
	}
	return intent
}

func moveFitsIntent(position *chess.Position, move *chess.Move, intent moveIntent) bool {
	isKingSideCastle := move.HasTag(chess.KingSideCastle)
	isQueenSideCastle := move.HasTag(chess.QueenSideCastle)
	if intent.castle != 0 {
		return (intent.castle == 1 && isKingSideCastle) || (intent.castle == 2 && isQueenSideCastle)
	}
	if isKingSideCastle || isQueenSideCastle {
		return false
	}

	piece := position.Board().Piece(move.S1()).Type()
	if intent.piece != chess.NoPieceType && piece != intent.piece {
		return false
	}
	if intent.hasDF && move.S2().File() != intent.dstFile {
		return false
	}
	if intent.hasDR && move.S2().Rank() != intent.dstRank {
		return false
	}
	if !intent.hasDF && !intent.hasDR && intent.piece == chess.NoPieceType {
		return false
	}
	if intent.hasSF && move.S1().File() != intent.srcFile {
		return false
	}
	if intent.hasSR && move.S1().Rank() != intent.srcRank {
		return false
	}
	if intent.capture && !move.HasTag(chess.Capture) {
		return false
	}
	if intent.promo != chess.NoPieceType && move.Promo() != intent.promo {
		return false
	}
	return true
}

func keytermsForMove(position *chess.Position, move *chess.Move) []string {
	terms := []string{
		chess.AlgebraicNotation{}.Encode(position, move),
		chess.UCINotation{}.Encode(position, move),
	}
	if move.HasTag(chess.KingSideCastle) {
		return append(terms, "castle", "castle kingside", "kingside castle", "short castle", "o o")
	}
	if move.HasTag(chess.QueenSideCastle) {
		return append(terms, "castle", "castle queenside", "queenside castle", "long castle", "o o o")
	}

	piece := position.Board().Piece(move.S1()).Type()
	source := move.S1()
	target := move.S2()
	sourceFile := source.File().String()
	targetSquare := target.String()
	targetSpoken := spokenSquare(target)
	pieceName := pieceWord(piece)

	if piece == chess.Pawn {
		terms = append(terms, targetSquare, targetSpoken, "pawn "+targetSquare, "pawn to "+targetSquare, "pawn "+targetSpoken, "pawn to "+targetSpoken)
		if move.HasTag(chess.Capture) {
			terms = append(terms, sourceFile+" takes "+targetSquare, sourceFile+" takes "+targetSpoken, "pawn takes "+targetSquare, "pawn takes "+targetSpoken)
		}
		if move.Promo() != chess.NoPieceType {
			promotion := pieceWord(move.Promo())
			terms = append(terms, targetSquare+" "+promotion, targetSquare+" promote "+promotion, "promote to "+promotion)
		}
		return terms
	}

	terms = append(terms,
		pieceName+" "+targetSquare,
		pieceName+" to "+targetSquare,
		pieceName+" "+targetSpoken,
		pieceName+" to "+targetSpoken,
		pieceName+" "+sourceFile+" "+targetSquare,
		pieceName+" from "+source.String()+" to "+targetSquare,
		pieceName+" "+natoFile[int(source.File())]+" "+targetSpoken,
	)
	if move.HasTag(chess.Capture) {
		terms = append(terms, pieceName+" takes "+targetSquare, pieceName+" takes "+targetSpoken, pieceName+" captures "+targetSquare)
	}
	return terms
}

func spokenSquare(square chess.Square) string {
	return natoFile[int(square.File())] + " " + rankWord[int(square.Rank())]
}

func pieceWord(piece chess.PieceType) string {
	switch piece {
	case chess.King:
		return "king"
	case chess.Queen:
		return "queen"
	case chess.Rook:
		return "rook"
	case chess.Bishop:
		return "bishop"
	case chess.Knight:
		return "knight"
	case chess.Pawn:
		return "pawn"
	default:
		return ""
	}
}

func pieceLetter(pt chess.PieceType) string {
	switch pt {
	case chess.King:
		return "K"
	case chess.Queen:
		return "Q"
	case chess.Rook:
		return "R"
	case chess.Bishop:
		return "B"
	case chess.Knight:
		return "N"
	default:
		return ""
	}
}

func dedupeStrings(in []string) []string {
	seen := make(map[string]struct{}, len(in))
	out := make([]string, 0, len(in))
	for _, value := range in {
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

func dedupe(in []string) []string {
	return dedupeStrings(in)
}

func metaphoneLite(s string) string {
	if s == "" {
		return ""
	}
	if strings.HasPrefix(s, "kn") || strings.HasPrefix(s, "gn") || strings.HasPrefix(s, "pn") {
		s = "n" + s[2:]
	}
	if strings.HasPrefix(s, "wr") {
		s = "r" + s[2:]
	}
	s = strings.ReplaceAll(s, "ph", "f")
	s = strings.ReplaceAll(s, "ck", "k")
	var b strings.Builder
	var prev byte
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch c {
		case 'a', 'e', 'i', 'o', 'u', 'y':
			if i == 0 {
				b.WriteByte(c)
				prev = c
			}
			continue
		case 'c', 'q', 'k':
			c = 'k'
		case 'z':
			c = 's'
		case 'v':
			c = 'f'
		case 'j':
			c = 'g'
		}
		if c != prev {
			b.WriteByte(c)
		}
		prev = c
	}
	return b.String()
}

var pieceKeyIndex = func() map[string]chess.PieceType {
	index := make(map[string]chess.PieceType)
	for word, piece := range pieceLexicon {
		index[metaphoneLite(word)] = piece
	}
	return index
}()
