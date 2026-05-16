package config

import (
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Port           string
	AllowedOrigins map[string]struct{}
	ClerkSecretKey string
	ClerkJWKSURL   string
	ClerkIssuer    string
	ClerkAudience  []string
	ClerkAZP       []string
	MongoURI       string
	DeepgramAPIKey string
}

func Load() Config {
	return Config{
		Port:           port(),
		AllowedOrigins: parseOrigins(env("ALLOWED_ORIGINS", "http://localhost:3000")),
		ClerkSecretKey: os.Getenv("CLERK_SECRET_KEY"),
		ClerkJWKSURL:   strings.TrimSpace(os.Getenv("CLERK_JWKS_URL")),
		ClerkIssuer:    strings.TrimSpace(os.Getenv("CLERK_ISSUER")),
		ClerkAudience:  parseList(os.Getenv("CLERK_AUDIENCE")),
		ClerkAZP:       parseList(os.Getenv("CLERK_AUTHORIZED_PARTIES")),
		MongoURI:       os.Getenv("MONGODB_URI"),
		DeepgramAPIKey: os.Getenv("DEEPGRAM_API_KEY"),
	}
}

func parseList(raw string) []string {
	var values []string
	for _, part := range strings.Split(raw, ",") {
		value := strings.TrimSpace(part)
		if value != "" {
			values = append(values, value)
		}
	}
	return values
}

func port() string {
	if value := strings.TrimSpace(os.Getenv("PORT")); value != "" {
		return value
	}
	return env("GAME_SERVER_PORT", "8787")
}

func (c Config) Addr() string {
	return ":" + c.Port
}

func env(key string, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func parseOrigins(raw string) map[string]struct{} {
	origins := make(map[string]struct{})
	for _, part := range strings.Split(raw, ",") {
		origin := strings.TrimSpace(part)
		if origin != "" {
			origins[origin] = struct{}{}
		}
	}
	return origins
}

func IntEnv(key string, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return value
}
