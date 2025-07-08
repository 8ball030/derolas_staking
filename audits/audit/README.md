# Audit of `main` branch
The review has been performed based on the contract code in the following repository:<br>
`https://github.com/8ball030/derolas_staking` <br>
commit: `f8eaba2e8e9f61f76caba2fa4c05e3a9e48a949e` <br> 

 ## Objectives
The audit focused on contracts in repo <br>

## Repo not ready for build from scratch
### Yarn in derolas_staking/packages/hardhat failed
```
cd derolas_staking/packages/hardhat
yarn
#### A lot of time: 39 min with a lot fail
    at TLSSocket.emit (node:events:531:35)
    at node:net:338:12
➤ YN0013: │ wrappy@npm:1.0.2 can't be found in the cache and will be fetched from the remote registry
➤ YN0013: │ write-file-atomic@npm:6.0.0 can't be found in the cache and will be fetched from the remote registry
➤ YN0013: │ ws@npm:7.4.6 can't be found in the cache and will be fetched from the remote registry
➤ YN0013: │ ws@npm:7.5.10 can't be found in the cache and will be fetched from the remote registry
➤ YN0013: │ ws@npm:8.17.1 can't be found in the cache and will be fetched from the remote registry
➤ YN0066: │ typescript@patch:typescript@npm%3A4.9.5#~builtin<compat/typescript>::version=4.9.5&hash=a1c5e5: Cannot apply hunk #6
➤ YN0013: │ yoctocolors-cjs@npm:2.1.2 can't be found in the cache and will be fetched from the remote registry
➤ YN0013: │ zksync-ethers@npm:5.10.0 can't be found in the cache and will be fetched from the remote registry
➤ YN0013: │ zod@npm:3.24.3 can't be found in the cache and will be fetched from the remote registry
➤ YN0013: │ zustand@npm:5.0.0 can't be found in the cache and will be fetched from the remote registry
➤ YN0013: │ zustand@npm:5.0.3 can't be found in the cache and will be fetched from the remote registry
➤ YN0066: │ typescript@patch:typescript@npm%3A5.8.3#~builtin<compat/typescript>::version=5.8.3&hash=a1c5e5: Cannot apply hunk #1
➤ YN0000: └ Completed in 39m 56s
➤ YN0000: Failed with errors in 39m 57s
```
### Afrer yarn
```
cd derolas_staking/packages/hardhat
yarn # failed
npx hardhat compile
Need to install the following packages:
hardhat@2.23.0
Ok to proceed? (y) n
npm ERR! canceled
```

## Issue
#### Order function. Low issue.
```
constructor() - first
```
#### Don't needed getter for public variable
```
    function getEpochLength() public view returns (uint256) {
        return epochLength;
    }
```

#### Overflow issue. Not possible in 0.8.x Solidity. Medium issue
```
 uint256 blocksRemaining = epochToEndBlock[currentEpoch] - block.number;
        if (blocksRemaining < 0 ) {
            return 0;
        }
Can't be  uint < 0. Revert if epochToEndBlock[currentEpoch] < block.number in minus operation
```

#### Design issue. Claim only for 1 epoch. Critical issue.
```
function claim() external nonReentrant {
        require(currentEpoch > 0, "No epoch to claim from");
        uint8 claimEpoch = currentEpoch - 1;
        ...
}

This will only work for the single previus epoch. Because for every start epoch -> totalClaimed in function advanceEpoch() internal {totalClaimed = 0; }
Thus, the entire reward is calculated for one era (previous to the current one).
```

#### Misconfig comments. Medium issue
```
uint256 public immutable epochRewards = 8e17; // 1 OLAS => 1 OLAS 1e18
```

#### Design issue. Low issue.
```
receive() external payable {}
This makes it possible to accept native tokens bypassing donate(). 
Looks like it was added by mistake.
```

#### Non-changed emit. epochRewards is constant! Medium issue
```
        emit AuctionEnded(epochRewards);
```

#### gas optimization. Low issue/Notes
```
    mapping(uint8 => mapping(address => uint256)) public epochToDonations;
    mapping(uint8 => mapping(address => uint256)) public epochToClaimed;
    mapping(uint8 => uint256) public epochToTotalDonated;
    mapping(uint8 => uint256) public epochToEndBlock;
    mapping(uint8 => bool) public epochDonated;
->
mapping(uint256 => mapping(address => uint256)) public epochToDonations;
This is both safer and potentially better for performance.	
```

#### gas optimization. Low issue/Notes
```
    uint8 public constant maxDonatorsPerEpoch = 8;
Using native uint256 in constant is both safer and potentially better for performance.	
```

### Misconfig. Overengineering in modifier and require(). Low issue
```
    modifier onlyOncePerEpoch() {
        require(block.number >= epochToEndBlock[currentEpoch], "Epoch not over");
        _;
    }
	
  function endEpoch() external onlyOncePerEpoch nonReentrant {
        require(currentEpoch > 0, "No epoch to end");
        require(block.number > epochToEndBlock[currentEpoch], "Epoch not over");
        _endEpoch();
    }

block.number > epochToEndBlock[currentEpoch] vs
block.number >= epochToEndBlock[currentEpoch]

let imagine
block.number == epochToEndBlock[currentEpoch] -> pass onlyOncePerEpoch()
require(block.number > epochToEndBlock[currentEpoch] -> fail

So, only needed require(block.number > epochToEndBlock[currentEpoch], "Epoch not over");

+ if (!epochDonated[claimEpoch] && block.number > epochToEndBlock[claimEpoch] ) {}
with require(block.number > epochToEndBlock[currentEpoch], "Epoch not over"); before
```

### Misconfig. Overengineering in using internal function.
```
Example:
constructor(
    ) Ownable(_owner) {

        _endEpoch();

function _endEpoch() internal {
        if (currentEpoch > 0) {
            uint8 claimEpoch = currentEpoch - 1;
            if (!epochDonated[claimEpoch] && block.number > epochToEndBlock[claimEpoch] ) {
                donateUnclaimedRewards(claimEpoch);
            }
        } # skipped in constructor, but in

function endEpoch() external onlyOncePerEpoch nonReentrant {
        require(currentEpoch > 0, "No epoch to end");
        require(block.number > epochToEndBlock[currentEpoch], "Epoch not over");
        _endEpoch();
    }
currentEpoch > 0 = always in path: endEpoch() -> _endEpoch()
Logic should be as simple as possible. Use internal functions only if you have a bug: "Stack too deep"

Same:
function incentiveBalance() public view returns (uint256) {
        return IERC20(incentiveTokenAddress).balanceOf(address(this));
    }

    function canPlayGame() public view returns (bool) {
        return incentiveBalance() >= epochRewards;
    }

    function canPayTicket(uint256 claimAmount) public view returns (bool) {
        return incentiveBalance() >= claimAmount;
    }
Overengineering not only obfuscates the code, but also consumes unnecessary gas because it forces the code generator to make unoptimized jumps.
```

### Misconfig name vs logic. Medium/Low based on design
```
modifier onlyOncePerEpoch() {
        require(block.number >= epochToEndBlock[currentEpoch], "Epoch not over");
        _;
    }
The function name says only once per epoch. The actual action is any number of times when the current epoch has ended.
```

### Issue by design. endEpoch vs epochLength
```
function endEpoch() external onlyOncePerEpoch nonReentrant {} ->
function _endEpoch() internal {} ->
function advanceEpoch() internal {
        currentEpoch += 1;
        totalDonated = 0;
        totalClaimed = 0;
        epochToEndBlock[currentEpoch] = block.number + epochLength;
    }
There are holes between eras that do not belong to any era. 
This is not a problem of a specific function, but of the design, because an epoch lasts a fixed amount of blocks (epochToEndBlock[currentEpoch] = block.number + epochLength)
But, started new epoch only after call endEpoch().
So, t0 + epochlen = t1 ended first epoch.
Second start t0 + epochlen + delta t (for call and finalizing) Staking.endEpoch() ... etc
A different design is needed that does not start epochs manually or end epochs at a fixed length.
```






