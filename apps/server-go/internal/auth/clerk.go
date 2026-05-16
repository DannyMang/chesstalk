package auth

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/golang-jwt/jwt/v5"
)

type Verifier struct {
	keyfunc  keyfunc.Keyfunc
	issuer   string
	audience []string
	azp      map[string]struct{}
}

type Options struct {
	JWKSURL  string
	Issuer   string
	Audience []string
	AZP      []string
}

type Claims struct {
	AuthorizedParty string `json:"azp,omitempty"`
	jwt.RegisteredClaims
}

func NewVerifier(ctx context.Context, options Options) (*Verifier, error) {
	if strings.TrimSpace(options.JWKSURL) == "" {
		return nil, errors.New("CLERK_JWKS_URL is required")
	}
	kf, err := keyfunc.NewDefaultCtx(ctx, []string{options.JWKSURL})
	if err != nil {
		return nil, err
	}
	azp := make(map[string]struct{}, len(options.AZP))
	for _, value := range options.AZP {
		value = strings.TrimSpace(value)
		if value != "" {
			azp[value] = struct{}{}
		}
	}
	return &Verifier{
		keyfunc:  kf,
		issuer:   strings.TrimSpace(options.Issuer),
		audience: options.Audience,
		azp:      azp,
	}, nil
}

func (v *Verifier) Subject(ctx context.Context, token string) (string, error) {
	if v == nil {
		return "", errors.New("clerk verifier is not configured")
	}
	token = strings.TrimSpace(token)
	if token == "" {
		return "", errors.New("token is required")
	}

	parserOptions := []jwt.ParserOption{
		jwt.WithExpirationRequired(),
		jwt.WithLeeway(30 * time.Second),
		jwt.WithValidMethods([]string{jwt.SigningMethodRS256.Alg()}),
	}
	if v.issuer != "" {
		parserOptions = append(parserOptions, jwt.WithIssuer(v.issuer))
	}
	if len(v.audience) > 0 {
		parserOptions = append(parserOptions, jwt.WithAudience(v.audience...))
	}

	claims := &Claims{}
	parsed, err := jwt.ParseWithClaims(token, claims, v.keyfunc.KeyfuncCtx(ctx), parserOptions...)
	if err != nil {
		return "", err
	}
	if !parsed.Valid {
		return "", errors.New("token is invalid")
	}
	if strings.TrimSpace(claims.Subject) == "" {
		return "", errors.New("token subject missing")
	}
	if len(v.azp) > 0 {
		if _, ok := v.azp[claims.AuthorizedParty]; !ok {
			return "", errors.New("token authorized party is not allowed")
		}
	}
	return claims.Subject, nil
}
