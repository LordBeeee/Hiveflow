# Build from upstream source: community images are no longer available on Docker Hub.
FROM golang:1.25-alpine AS server-build
ARG MINIO_VERSION=v0.0.0-20260212201848-7aac2a2c5b7c
ENV CGO_ENABLED=0 GOFLAGS=-p=2
RUN go install -trimpath -ldflags="-s -w" github.com/minio/minio@${MINIO_VERSION} \
    && mkdir /licenses \
    && cp /go/pkg/mod/github.com/minio/minio@${MINIO_VERSION}/LICENSE /licenses/LICENSE

FROM golang:1.25-alpine AS client-build
ARG MC_VERSION=v0.0.0-20251106162529-77f82e18b540
ENV CGO_ENABLED=0 GOFLAGS=-p=2
RUN go install -trimpath -ldflags="-s -w" github.com/minio/mc@${MC_VERSION} \
    && mkdir /licenses \
    && cp /go/pkg/mod/github.com/minio/mc@${MC_VERSION}/LICENSE /licenses/LICENSE

FROM alpine:3.22 AS runtime
RUN apk add --no-cache ca-certificates

FROM runtime AS minio
COPY --from=server-build /go/bin/minio /usr/local/bin/minio
COPY --from=server-build /licenses /licenses
EXPOSE 9000 9001
ENTRYPOINT ["minio"]
CMD ["server", "/data", "--console-address", ":9001"]

FROM runtime AS mc
COPY --from=client-build /go/bin/mc /usr/local/bin/mc
COPY --from=client-build /licenses /licenses
ENTRYPOINT ["mc"]
