# Build
FROM golang:1.22-alpine AS build
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/price-parser ./

# Runtime
FROM alpine:3.20
WORKDIR /app
COPY --from=build /out/price-parser /usr/local/bin/price-parser
USER 65532:65532
ENTRYPOINT ["price-parser"]
