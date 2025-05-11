# Audit of `main` branch
The review has been performed based on the contract code in the following repository:<br>
`https://github.com/8ball030/derolas_staking` <br>
commit: `fb691787c559da64cc5b64715824cebf664da602` <br> 

 ## Objectives
The audit focused on contracts in repo <br>

## Unclear assembly problems. Perhaps the assembly instructions should be clarified.
### Yarn in derolas_staking/packages/hardhat failed
```
cd derolas_staking/packages/hardhat
yarn
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
[]

## Ai-based report
No accepted issue.
AI based report: [AI-report.md](https://github.com/8ball030/derolas_staking/blob/main/audits/audit2/AI-report.md).

## Issue
### Critical issue. maxNumDonators incorrect in donate
```
        require(epochPoints[curEpoch].totalDonated < epochPoints[curEpoch].maxNumDonators, "Max donators reached"); // Bug!
        epochPoints[curEpoch].totalDonated += msg.value; 
        
        Logical comparison error.
        uint256 maxNumDonators;      // Maximum number of donators allowed in this epoch
        uint256 totalDonated;        // Total amount donated in this epoch
        Incorrect attempt to add and compare funds with the number of donors.
```
[]

### Medium issue. DoS in checkpoint (EndEpoch)
```
function _donateUnclaimedRewards(uint256 claimEpoch) internal {
        uint256 unclaimedAmount = epochPoints[claimEpoch].availableRewards - epochPoints[claimEpoch].totalClaimed;
        if (unclaimedAmount == 0) {
            return;
        }

        require(IERC20(incentiveTokenAddress).balanceOf(address(this)) >= unclaimedAmount, "Not enough incentive balance to donate");

        uint256[] memory amountsIn = new uint256[](assetsInPool);
        amountsIn[incentiveTokenIndex] = unclaimedAmount;

        IERC20(incentiveTokenAddress).approve(permit2, 0);
        IERC20(incentiveTokenAddress).approve(permit2, unclaimedAmount);
        IPermit2(permit2).approve(incentiveTokenAddress, balancerRouter, uint160(unclaimedAmount), uint48(block.timestamp + 1 days));
        IBalancerRouter(balancerRouter).donate(poolId, amountsIn, true, "");

        emit UnclaimedRewardsDonated(unclaimedAmount);
    }
require(IERC20(incentiveTokenAddress).balanceOf(address(this)) >= unclaimedAmount, "Not enough incentive balance to donate"); - does not allow the epoch to end and will stop everything.

+question:
IStaking(stakingInstance).checkpoint(); is safe for un-revert in EndEpoch?
```

### Low issue. claimable vs claim
```
The view function `claimable` does not take into account all the limitations of the "real" `claim`. It should give the same result. 
Probably for emergency events like lack of funds, a revert is better than a return of zero.
Ref: require(IERC20(incentiveTokenAddress).balanceOf(address(this)) >= amount, "Not enough rewards");
```
[]

### Low issue. Overchecked 
```
    /// @dev Top ups incentive balance.
    /// @param amount Amount to top up.
    function topUpIncentiveBalance(uint256 amount) external {
        require(amount > 0, "Amount must be greater than 0");
        require(IERC20(incentiveTokenAddress).balanceOf(msg.sender) >= amount, "Not enough rewards"); // checked in safetransfer
        require(IERC20(incentiveTokenAddress).allowance(msg.sender, address(this)) >= amount, "Not enough allowance"); // checked in safetransfer 

        SafeTransferLib.safeTransferFrom(incentiveTokenAddress, msg.sender, address(this), amount);
    }
```
[]

### Notes. Reset to zero lead to loss information?
```
The function does not differentiate between an era "theoretically" ending (secondsSinceEpochEnd == curEpochLength) and one that has continued beyond the theoretical limit. It is reasonable to return the remainder as the second parameter rather than zeroing it.
function getRemainingEpochLength() public view returns (uint256) {
        uint256 curEpoch = currentEpoch;
        uint256 secondsSinceEpochEnd = block.timestamp - epochPoints[curEpoch - 1].endTime;

        uint256 curEpochLength = epochPoints[curEpoch].length;
        if (secondsSinceEpochEnd > curEpochLength) {
            secondsSinceEpochEnd = curEpochLength;
        }

        return secondsSinceEpochEnd - curEpochLength;
    }
```
[]






