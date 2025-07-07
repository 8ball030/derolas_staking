test: 
	yarn hardhat:test
fmt: 
	yarn hardhat:format
lint: 
	yarn hardhat:lint

all: fmt lint test
