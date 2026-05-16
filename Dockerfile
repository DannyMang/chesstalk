FROM golang:1.23-alpine AS build

WORKDIR /src/apps/server-go
COPY apps/server-go/go.mod apps/server-go/go.sum ./
RUN go mod download

COPY apps/server-go ./
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/chesstalk-server ./cmd/chesstalk-server

FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates stockfish \
  && rm -rf /var/lib/apt/lists/*
RUN useradd --system --create-home --home-dir /home/chesstalk chesstalk
USER chesstalk
WORKDIR /app

COPY --from=build /out/chesstalk-server /app/chesstalk-server

ENV STOCKFISH_PATH=/usr/games/stockfish
EXPOSE 8787
CMD ["/app/chesstalk-server"]
