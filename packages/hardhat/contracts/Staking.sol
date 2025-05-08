//SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {SafeTransferLib} from "./libraries/SafeTransferLib.sol";

interface IBalancerRouter {
    function donate(
        address pool,
        uint256[] memory amountsIn,
        bool wethIsEth,
        bytes memory userData
    ) external payable;
    // get permit2
    function getPermit2() external view returns (address);
}

interface IERC20 {
    /// @dev Gets the amount of tokens owned by a specified account.
    /// @param account Account address.
    /// @return Amount of tokens owned.
    function balanceOf(address account) external view returns (uint256);

    /// @dev Sets `amount` as the allowance of `spender` over the caller's tokens.
    /// @param spender Account address that will be able to transfer tokens on behalf of the caller.
    /// @param amount Token amount.
    /// @return True if the function execution is successful.
    function approve(address spender, uint256 amount) external returns (bool);

    /// @dev Gets remaining number of tokens that the `spender` can transfer on behalf of `owner`.
    /// @param owner Token owner.
    /// @param spender Account address that is able to transfer tokens on behalf of the owner.
    /// @return Token amount allowed to be transferred.
    function allowance(address owner, address spender) external view returns (uint256);
}

interface IPermit2 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

// Staking interface
interface IStaking {
    /// @dev Gets activity checker address.
    /// @return Activity checker address.
    function activityChecker() external view returns (address);
}


contract DerolasStaking {
    event OwnerUpdated(address indexed owner);
    event DonationReceived(address indexed donatorAddress, uint256 indexed amount);
    event AuctionEnded(uint256 indexed epochCounter, uint256 indexed totalDonated, uint256 indexed totalClaimed,
        uint256 epochRewards);
    event UnclaimedRewardsDonated(uint256 indexed amount);
    event RewardsClaimed(address indexed donatorAddress, uint256 indexed amount);
    event StakingInstanceUpdated(address indexed stakingInstance);
    event ParamsUpdated(uint256 indexed nextEpoch, uint256 epochRewards, uint256 epochLength, uint256 maxDonatorsPerEpoch);

    address public immutable permit2;

    address public immutable balancerRouter;
    address public immutable poolId;
    uint256 public immutable assetsInPool;
    uint256 public immutable incentiveTokenIndex;
    address public immutable incentiveTokenAddress;

    uint256 public immutable minimumDonation;

    uint256 public totalDonated;
    uint256 public totalClaimed;
    uint256 public currentEpoch = 1;

    // Staking instance address
    address public stakingInstance;
    // Contract owner address
    address public owner;

    bool public paramsUpdateRequested;
    
    // Reentrancy lock
    uint256 internal _locked = 1;

    mapping(uint256 => mapping(address => uint256)) public epochToDonations;
    mapping(uint256 => mapping(address => uint256)) public epochToClaimed;
    mapping(uint256 => uint256) public epochRewards;
    mapping(uint256 => uint256) public epochTotalDonated;
    mapping(uint256 => uint256) public epochTotalClaimed;
    mapping(uint256 => uint256) public epochLengths;
    mapping(uint256 => uint256) public epochMaxNumDonators;
    mapping(uint256 => uint256) public epochEndTimes;

    constructor(
        uint256 _minimumDonation,
        address _balancerRouter,
        address _poolId,
        uint256 _assetsInPool,
        address _incentiveTokenAddress,
        uint256 _incentiveTokenIndex,
        uint256 _epochRewards,
        uint256 _epochLength,
        uint256 _maxDonatorsPerEpoch
    ) {
        // TODO checks for zero values / addresses?
        minimumDonation = _minimumDonation;
        balancerRouter = _balancerRouter;
        poolId = _poolId;
        assetsInPool = _assetsInPool;
        incentiveTokenAddress = _incentiveTokenAddress;
        incentiveTokenIndex = _incentiveTokenIndex;
        permit2 = IBalancerRouter(_balancerRouter).getPermit2();
        epochRewards[1] = _epochRewards;
        epochLengths[1] = _epochLength;
        epochMaxNumDonators[1] = _maxDonatorsPerEpoch;

        epochEndTimes[0] = block.timestamp;
        owner = msg.sender;
    }

    function _donateUnclaimedRewards(uint256 epoch) internal {
        uint256 unclaimedAmount = epochRewards[epoch] - epochTotalClaimed[epoch];
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

    function endEpoch() external {
        // Reentrancy guard
        require(_locked == 1, "ReentrancyGuard");
        _locked = 2;

        uint256 curEpoch = currentEpoch;
        uint256 claimEpoch = curEpoch - 1;
        require(block.timestamp > epochEndTimes[claimEpoch] + epochLengths[curEpoch], "Epoch not over");

        _donateUnclaimedRewards(claimEpoch);

        uint256 curTotalDonated = totalDonated;
        uint256 curTotalClaimed = totalClaimed;
        epochTotalDonated[curEpoch] = curTotalDonated;
        epochTotalClaimed[curEpoch] = curTotalClaimed;
        epochEndTimes[curEpoch] = block.timestamp;
        uint256 nextEpoch = curEpoch + 1;
        currentEpoch = nextEpoch;
        totalDonated = 0;
        totalClaimed = 0;

        if (!paramsUpdateRequested) {
            epochRewards[nextEpoch] = epochRewards[curEpoch];
            epochLengths[nextEpoch] = epochLengths[curEpoch];
            epochMaxNumDonators[nextEpoch] = epochMaxNumDonators[curEpoch];
        }

        emit AuctionEnded(curEpoch, curTotalDonated, curTotalClaimed, epochRewards[curEpoch]);

        _locked = 1;
    }

    function claim() external {
        // Reentrancy guard
        require(_locked == 1, "ReentrancyGuard");
        _locked = 2;

        uint256 claimEpoch = currentEpoch - 1;
        require(epochEndTimes[claimEpoch] > 0, "Epoch not ended yet");
        require(epochToClaimed[claimEpoch][msg.sender] == 0, "Already claimed");

        uint256 donation = epochToDonations[claimEpoch][msg.sender];
        require(donation > 0, "No donation found");

        uint256 totalEpochDonations = epochTotalDonated[claimEpoch];
        require(totalEpochDonations > 0, "No donations this epoch");

        uint256 amount = (donation * epochRewards[claimEpoch]) / totalEpochDonations;
        require(amount > 0, "Nothing to claim");
        require(IERC20(incentiveTokenAddress).balanceOf(address(this)) >= amount, "Not enough rewards");

        epochToClaimed[claimEpoch][msg.sender] = amount;

        SafeTransferLib.safeTransfer(incentiveTokenAddress, msg.sender, amount);

        totalClaimed += amount;
        emit RewardsClaimed(msg.sender, amount);

        _locked = 1;
    }

    /// @dev Changes contract owner address.
    /// @param newOwner Address of a new owner.
    function changeOwner(address newOwner) external virtual {
        // Check current contract owner
        require(msg.sender == owner, "Unauthorized account");
        // Check for zero address
        require(newOwner != address(0), "Zero address");

        owner = newOwner;
        emit OwnerUpdated(newOwner);
    }

    /// @dev Sets staking instance contract address only once.
    /// @param _stakingInstance Staking instance contract address.
    function setStakingInstance(address _stakingInstance) external {
        // Check current contract owner
        require(msg.sender == owner, "Unauthorized account");
        // Check for zero address
        require(_stakingInstance != address(0), "Zero address");
        // Check for non-zero address staking instance address
        require(stakingInstance == address(0), "Already set");
        // Check for activity checker pointing to this contract
        require(IStaking(stakingInstance).activityChecker() == address(this), "Wrong staking instance");

        stakingInstance = _stakingInstance;

        emit StakingInstanceUpdated(_stakingInstance);
    }

    function changeParams(uint256 newEpochRewards, uint256 newEpochLength, uint256 newMaxDonatorsPerEpoch) external {
        // Check current contract owner
        require(msg.sender == owner, "Unauthorized account");

        uint256 nextEpoch = currentEpoch + 1;
        epochRewards[nextEpoch] = newEpochRewards;
        epochLengths[nextEpoch] = newEpochLength;
        epochMaxNumDonators[nextEpoch] = newMaxDonatorsPerEpoch;
        paramsUpdateRequested = true;

        emit ParamsUpdated(nextEpoch, newEpochRewards, newEpochLength, newMaxDonatorsPerEpoch);
    }

    function claimable(address account) external view returns (uint256) {
        uint256 claimEpoch = currentEpoch - 1;
        uint256 donation = epochToDonations[claimEpoch][account];
        uint256 totalEpochDonations = epochTotalDonated[claimEpoch];

        if (donation == 0 || totalEpochDonations == 0) {
            return 0;
        }

        return (donation * epochRewards[claimEpoch]) / totalEpochDonations;
    }

    function estimateTicketPercentage(uint256 donation) external view returns (uint256) {
        require(donation >= minimumDonation, "Minimum donation not met");
        require(IERC20(incentiveTokenAddress).balanceOf(address(this)) >= epochRewards[currentEpoch],
            "Not enough rewards to play the game");

        if (totalDonated == 0) {
            return 1e18; // full share
        }

        return (donation * 1e18) / totalDonated;
    }

    function donate() external payable {
        // Reentrancy guard
        require(_locked == 1, "ReentrancyGuard");
        _locked = 2;

        require(msg.value >= minimumDonation, "Donation amount is less than the minimum donation");
        require(IERC20(incentiveTokenAddress).balanceOf(address(this)) >= epochRewards[currentEpoch],
            "Not enough rewards to play the game");

        uint256 curEpoch = currentEpoch;
        require(epochToDonations[curEpoch][msg.sender] == 0, "Already donated this epoch");
        require(epochTotalDonated[curEpoch] < epochMaxNumDonators[curEpoch], "Max donators reached");

        totalDonated += msg.value;
        epochToDonations[curEpoch][msg.sender] = msg.value;

        emit DonationReceived(msg.sender, msg.value);

        _locked = 1;
    }

    function topUpIncentiveBalance(uint256 amount) external {
        require(amount > 0, "Amount must be greater than 0");
        require(IERC20(incentiveTokenAddress).balanceOf(msg.sender) >= amount, "Not enough rewards");
        // TODO this can go away since safeTransferFrom will take care of it
        require(IERC20(incentiveTokenAddress).allowance(msg.sender, address(this)) >= amount, "Not enough allowance");

        SafeTransferLib.safeTransferFrom(incentiveTokenAddress, msg.sender, address(this), amount);
    }

    function getCurrentShare(address account) external view returns (uint256) {
        uint256 donation = epochToDonations[currentEpoch][account];
        return (donation * 1e18) / totalDonated;
    }

    /// @dev Gets seconds since last epoch end.
    function getSecondsSinceEpochEnd() external view returns (uint256) {
        return block.timestamp - epochEndTimes[currentEpoch - 1];
    }

    /// @dev Gets remaining epoch length progress.
    function getRemainingEpochLength() public view returns (uint256) {
        uint256 curEpoch = currentEpoch;
        // Get seconds since last epoch end
        uint256 secondsSinceEpochEnd = block.timestamp - epochEndTimes[curEpoch - 1];

        uint256 curEpochLength = epochLengths[curEpoch];
        // If more seconds have passed compared to defined epoch length, limit by epoch length
        if (secondsSinceEpochEnd > curEpochLength) {
            secondsSinceEpochEnd = curEpochLength;
        }

        return secondsSinceEpochEnd - curEpochLength;
    }

    /// @dev Gets epoch progress.
    function getEpochProgress() external view returns (uint256) {
        uint256 curEpoch = currentEpoch;
        // Get seconds since last epoch end
        uint256 secondsSinceEpochEnd = block.timestamp - epochEndTimes[currentEpoch - 1];

        uint256 curEpochLength = epochLengths[curEpoch];
        // If more seconds have passed compared to defined epoch length, limit by epoch length
        if (secondsSinceEpochEnd > curEpochLength) {
            secondsSinceEpochEnd = curEpochLength;
        }

        return (secondsSinceEpochEnd * 100) / curEpochLength;
    }

    function getTotalUnclaimed() external view returns (uint256) {
        uint256 claimEpoch = currentEpoch - 1;
        return epochRewards[claimEpoch] - epochTotalClaimed[claimEpoch];
    }

    /// @dev Gets service multisig nonces.
    /// @param multisig Service multisig address.
    /// @return nonces Current donations value.
    function getMultisigNonces(address multisig) external view virtual returns (uint256[] memory nonces) {
        nonces = new uint256[](1);
        // The nonce is equal to the total donations value
        nonces[0] = epochToDonations[currentEpoch][multisig];
    }

    /// @dev Checks if the service multisig liveness ratio passes the defined liveness threshold.
    /// @notice The ratio pass is true if there was a difference in donations between previous and current checkpoints.
    /// @param curNonces Current service multisig set of a single nonce.
    /// @param lastNonces Last service multisig set of a single nonce.
    /// @return ratioPass True, if the liveness ratio passes the check.
    function isRatioPass(
        uint256[] memory curNonces,
        uint256[] memory lastNonces,
        uint256
    ) external view virtual returns (bool ratioPass) {
        // If the checkpoint was called in the exact same block, the ratio is zero
        // If the current nonce is not greater than the last nonce, the ratio is zero
        if (curNonces[0] > lastNonces[0]) {
            ratioPass = true;
        }
    }

    receive() external payable {}
}
