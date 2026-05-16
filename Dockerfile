FROM golang:1.23-alpine AS build

WORKDIR /src/apps/server-go
COPY apps/server-go/go.mod apps/server-go/go.sum ./
RUN go mod download

COPY apps/server-go ./
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/chesstalk-server ./cmd/chesstalk-server

FROM alpine:3.21

RUN apk add --no-cache ca-certificates stockfish
RUN adduser -D -H chesstalk
USER chesstalk
WORKDIR /app

COPY --from=build /out/chesstalk-server /app/chesstalk-server

EXPOSE 8787
CMD ["/app/chesstalk-server"]
