FROM rust:1-alpine AS build
RUN apk add --no-cache musl-dev gcc
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY public ./public
RUN cargo build --release

FROM scratch
COPY --from=build /src/target/release/elf-punch /elf-punch
EXPOSE 8080
ENTRYPOINT ["/elf-punch"]
