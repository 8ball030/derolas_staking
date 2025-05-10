//SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {SafeTransferLib} from "./libraries/SafeTransferLib.sol";

interface IBalancerRouter {
    /// @dev Donates tokens to a pool.
    /// @param pool Pool address.
    /// @param amountsIn Amounts of tokens to donate.
    /// @param wethIsEth Whether WETH is ETH.
    /// @param userData User data.
    function donate(
        address pool,
        uint256[] memory amountsIn,
        bool wethIsEth,
        bytes memory userData
    ) external payable;
    
    /// @dev Gets permit2 address.
    /// @return permit2 address.
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
    /// @dev Approves a token for a spender.
    /// @param token Token address.
    /// @param spender Account address that will be able to transfer tokens on behalf of the owner.
    /// @param amount Token amount.
    /// @param expiration Expiration timestamp.
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

// Staking interface
interface IStaking {
    /// @dev Checkpoint to allocate rewards up until a current time.
    /// @return serviceIds Staking service Ids (excluding evicted ones within a current epoch).
    /// @return eligibleServiceIds Set of reward-eligible service Ids.
    /// @return eligibleServiceRewards Corresponding set of reward-eligible service rewards.
    /// @return evictServiceIds Evicted service Ids.
    function checkpoint() external returns (uint256[] memory serviceIds, uint256[] memory eligibleServiceIds,
        uint256[] memory eligibleServiceRewards, uint256[] memory evictServiceIds);

    /// @dev Gets activity checker address.
    /// @return Activity checker address.
    function activityChecker() external view returns (address);

    /// @dev Gets timestamp of the last staking checkpoint.
    /// @return Timestamp of the last staking checkpoint.
    function tsCheckpoint() external returns (uint256);
}

/// @dev Epoch point struct.
struct EpochPoint {
    uint256 availableRewards;
    uint256 totalDonated;
    uint256 totalClaimed;
    uint256 length;
    uint256 maxNumDonators;
    uint256 maxCheckpointDelay;
    uint256 minDonations;
    uint256 endTime;
}

/// @title Derolas staking contract.
contract DerolasStaking {
    event OwnerUpdated(address indexed owner);
    event DonationReceived(address indexed donatorAddress, uint256 indexed amount);
    event AuctionEnded(uint256 indexed epochCounter, uint256 indexed totalEpochDonations,
        uint256 indexed totalEpochClaimed, uint256 availableRewards);
    event UnclaimedRewardsDonated(uint256 indexed amount);
    event RewardsClaimed(address indexed donatorAddress, uint256 indexed amount);
    event StakingInstanceUpdated(address indexed stakingInstance);
    event ParamsUpdated(uint256 indexed nextEpoch, uint256 availableRewards, uint256 epochLength,
        uint256 maxDonatorsPerEpoch, uint256 maxCheckpointDelay, uint256 minDonation);

    // Assets in pool
    uint256 public immutable assetsInPool;
    // Incentive token index
    uint256 public immutable incentiveTokenIndex;
    // Incentive token address
    address public immutable incentiveTokenAddress;
    // Balancer router address
    address public immutable balancerRouter;
    // Pool ID
    address public immutable poolId;
    // Permit2 address
    address public immutable permit2;

    // Epoch counter
    uint256 public currentEpoch = 1;
    // Staking instance address
    address public stakingInstance;
    // Contract owner address
    address public owner;
    // Params update request status
    bool public paramsUpdateRequested;
    
    // Reentrancy lock
    uint256 internal _locked = 1;

    // Mapping of epoch => (mapping of donator => amount donated)
    mapping(uint256 => mapping(address => uint256)) public epochToDonations;
    // Mapping of epoch => (mapping of claimer => amount claimed)
    mapping(uint256 => mapping(address => uint256)) public epochToClaimed;
    // Mapping of epoch => epoch points
    mapping(uint256 => EpochPoint) public epochPoints;

    /// @dev Constructor.
    /// @param _minDonation Minimum epoch donation.
    /// @param _balancerRouter Balancer router address.
    /// @param _poolId Pool ID.
    /// @param _assetsInPool Assets in pool.
    /// @param _incentiveTokenAddress Incentive token address.
    /// @param _incentiveTokenIndex Incentive token index.
    /// @param _availableRewards Available rewards.
    /// @param _epochLength Epoch length.
    /// @param _maxDonatorsPerEpoch Maximum donators per epoch.
    /// @param _maxCheckpointDelay Maximum checkpoint delay.
    constructor(
        uint256 _minDonation,
        address _balancerRouter,
        address _poolId,
        uint256 _assetsInPool,
        address _incentiveTokenAddress,
        uint256 _incentiveTokenIndex,
        uint256 _availableRewards,
        uint256 _epochLength,
        uint256 _maxDonatorsPerEpoch,
        uint256 _maxCheckpointDelay
    ) {
        // TODO checks for zero values / addresses?
        balancerRouter = _balancerRouter;
        poolId = _poolId;
        assetsInPool = _assetsInPool;
        incentiveTokenAddress = _incentiveTokenAddress;
        incentiveTokenIndex = _incentiveTokenIndex;
        permit2 = IBalancerRouter(_balancerRouter).getPermit2();
        epochPoints[1].availableRewards = _availableRewards;
        epochPoints[1].length = _epochLength;
        epochPoints[1].maxNumDonators = _maxDonatorsPerEpoch;
        epochPoints[1].maxCheckpointDelay = _maxCheckpointDelay;
        epochPoints[1].minDonations = _minDonation;

        epochPoints[0].endTime = block.timestamp;
        owner = msg.sender;
    }

    /// @dev Donates unclaimed rewards.
    /// @param claimEpoch Claim epoch.
    function _donateUnclaimedRewards(uint256 claimEpoch) internal {
        uint256 unclaimedAmount = epochPoints[claimEpoch].availableRewards - epochPoints[claimEpoch].totalClaimed;
        if (unclaimedAmount == 0) {
            return;
        }

        // This must never happen
        require(IERC20(incentiveTokenAddress).balanceOf(address(this)) >= unclaimedAmount, "Not enough incentive balance to donate");

        uint256[] memory amountsIn = new uint256[](assetsInPool);
        amountsIn[incentiveTokenIndex] = unclaimedAmount;

        IERC20(incentiveTokenAddress).approve(permit2, 0);
        IERC20(incentiveTokenAddress).approve(permit2, unclaimedAmount);
        IPermit2(permit2).approve(incentiveTokenAddress, balancerRouter, uint160(unclaimedAmount), uint48(block.timestamp + 1 days));
        IBalancerRouter(balancerRouter).donate(poolId, amountsIn, true, "");

        emit UnclaimedRewardsDonated(unclaimedAmount);
    }

    /// @dev Ends an epoch.
    function endEpoch() external {
        // Reentrancy guard
        require(_locked == 1, "ReentrancyGuard");
        _locked = 2;

        uint256 curEpoch = currentEpoch;
        uint256 claimEpoch = curEpoch - 1;
        require(block.timestamp > epochPoints[curEpoch].endTime+ epochPoints[curEpoch].length, "Epoch not over");

        // Check for staking checkpoint time difference
        uint256 lastStakingCheckpointDelay = block.timestamp - IStaking(stakingInstance).tsCheckpoint();
        require(lastStakingCheckpointDelay <= epochPoints[curEpoch].maxCheckpointDelay, "Staking epoch end time difference overflow");

        _donateUnclaimedRewards(claimEpoch);

        uint256 nextEpoch = curEpoch + 1;

        // Check for updated params not being requested for the next epoch
        if (!paramsUpdateRequested) {
            epochPoints[nextEpoch].availableRewards = epochPoints[curEpoch].availableRewards;
            epochPoints[nextEpoch].length= epochPoints[curEpoch].length;
            epochPoints[nextEpoch].maxNumDonators = epochPoints[curEpoch].maxNumDonators;
            epochPoints[nextEpoch].maxCheckpointDelay = epochPoints[curEpoch].maxCheckpointDelay;
        }

        // Update state variables
        epochPoints[curEpoch].endTime = block.timestamp;
        currentEpoch = nextEpoch;

        // Call staking checkpoint
        IStaking(stakingInstance).checkpoint();

        emit AuctionEnded(curEpoch, epochPoints[curEpoch].totalDonated, epochPoints[claimEpoch].totalClaimed,
            epochPoints[curEpoch].availableRewards);

        _locked = 1;
    }

    /// @dev Claims rewards.
    function claim() external {
        // Reentrancy guard
        require(_locked == 1, "ReentrancyGuard");
        _locked = 2;

        uint256 claimEpoch = currentEpoch - 1;
        require(epochPoints[claimEpoch].endTime > 0, "Epoch not ended yet");
        require(epochToClaimed[claimEpoch][msg.sender] == 0, "Already claimed");

        uint256 donation = epochToDonations[claimEpoch][msg.sender];
        require(donation > 0, "No donation found");

        uint256 totalEpochDonations = epochPoints[claimEpoch].totalDonated;
        require(totalEpochDonations > 0, "No donations this epoch");

        uint256 amount = (donation * epochPoints[claimEpoch].availableRewards) / totalEpochDonations;
        require(amount > 0, "Nothing to claim");
        require(IERC20(incentiveTokenAddress).balanceOf(address(this)) >= amount, "Not enough rewards");

        epochToClaimed[claimEpoch][msg.sender] = amount;
        epochPoints[claimEpoch].totalClaimed += amount;

        SafeTransferLib.safeTransfer(incentiveTokenAddress, msg.sender, amount);

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

    /// @dev Changes epoch parameters.
    /// @param newEpochRewards New epoch rewards.
    /// @param newEpochLength New epoch length.
    /// @param newMaxDonatorsPerEpoch New maximum donators per epoch.
    /// @param newMaxCheckpointDelay New maximum checkpoint delay.
    /// @param minDonation New minimum donation.
    function changeParams(
        uint256 newEpochRewards,
        uint256 newEpochLength,
        uint256 newMaxDonatorsPerEpoch,
        uint256 newMaxCheckpointDelay,
        uint256 minDonation
    ) external {
        // Check current contract owner
        require(msg.sender == owner, "Unauthorized account");

        uint256 nextEpoch = currentEpoch + 1;
        epochPoints[nextEpoch].availableRewards = newEpochRewards;
        epochPoints[nextEpoch].length = newEpochLength;
        epochPoints[nextEpoch].maxNumDonators = newMaxDonatorsPerEpoch;
        epochPoints[nextEpoch].maxCheckpointDelay = newMaxCheckpointDelay;
        epochPoints[nextEpoch].minDonations = minDonation;
        paramsUpdateRequested = true;

        emit ParamsUpdated(nextEpoch, newEpochRewards, newEpochLength, newMaxDonatorsPerEpoch, newMaxCheckpointDelay,
            minDonation);
    }

    /// @dev Gets claimable rewards.
    /// @param account Account address.
    /// @return Claimable rewards.
    function claimable(address account) external view returns (uint256) {
        uint256 claimEpoch = currentEpoch - 1;
        uint256 donation = epochToDonations[claimEpoch][account];
        uint256 totalEpochDonations = epochPoints[claimEpoch].totalDonated;

        if (donation == 0 || totalEpochDonations == 0) {
            return 0;
        }

        return (donation * epochPoints[claimEpoch].availableRewards) / totalEpochDonations;
    }

    /// @dev Estimates ticket percentage.
    /// @param donation Donation amount.
    /// @return Ticket percentage.
    function estimateTicketPercentage(uint256 donation) external view returns (uint256) {
        uint256 curEpoch = currentEpoch;
        require(donation >= epochPoints[curEpoch].minDonations, "Minimum donation not met");
        require(IERC20(incentiveTokenAddress).balanceOf(address(this)) >= epochPoints[curEpoch].availableRewards,
            "Not enough rewards to play the game");

        uint256 totalEpochDonations = epochPoints[curEpoch].totalDonated;
        if (totalEpochDonations == 0) {
            return 1e18; // full share
        }

        return (donation * 1e18) / totalEpochDonations;
    }

    /// @dev Donates to the staking contract.
    function donate() external payable {
        // Reentrancy guard
        require(_locked == 1, "ReentrancyGuard");
        _locked = 2;

        uint256 curEpoch = currentEpoch;
        require(msg.value >= epochPoints[curEpoch].minDonations, "Donation amount is less than the minimum donation");
        require(IERC20(incentiveTokenAddress).balanceOf(address(this)) >= epochPoints[curEpoch].availableRewards,
            "Not enough rewards to play the game");

        require(epochToDonations[curEpoch][msg.sender] == 0, "Already donated this epoch");
        require(epochPoints[curEpoch].totalDonated < epochPoints[curEpoch].maxNumDonators, "Max donators reached");

        epochPoints[curEpoch].totalDonated += msg.value;
        epochToDonations[curEpoch][msg.sender] = msg.value;

        emit DonationReceived(msg.sender, msg.value);

        _locked = 1;
    }

    /// @dev Top ups incentive balance.
    /// @param amount Amount to top up.
    function topUpIncentiveBalance(uint256 amount) external {
        require(amount > 0, "Amount must be greater than 0");
        require(IERC20(incentiveTokenAddress).balanceOf(msg.sender) >= amount, "Not enough rewards");
        // TODO this can go away since safeTransferFrom will take care of it
        require(IERC20(incentiveTokenAddress).allowance(msg.sender, address(this)) >= amount, "Not enough allowance");

        SafeTransferLib.safeTransferFrom(incentiveTokenAddress, msg.sender, address(this), amount);
    }

    /// @dev Gets current share.
    /// @param account Account address.
    /// @return Current share.
    function getCurrentShare(address account) external view returns (uint256) {
        uint256 curEpoch = currentEpoch;
        uint256 donation = epochToDonations[curEpoch][account];
        return (donation * 1e18) / epochPoints[curEpoch].totalDonated;
    }

    /// @dev Gets seconds since last epoch end.
    /// @return Seconds since last epoch end.
    function getSecondsSinceEpochEnd() external view returns (uint256) {
        return block.timestamp - epochPoints[currentEpoch - 1].endTime;
    }

    /// @dev Gets remaining epoch length progress.
    /// @return Remaining epoch length progress.
    function getRemainingEpochLength() public view returns (uint256) {
        uint256 curEpoch = currentEpoch;
        // Get seconds since last epoch end
        uint256 secondsSinceEpochEnd = block.timestamp - epochPoints[curEpoch - 1].endTime;

        uint256 curEpochLength = epochPoints[curEpoch].length;
        // If more seconds have passed compared to defined epoch length, limit by epoch length
        if (secondsSinceEpochEnd > curEpochLength) {
            secondsSinceEpochEnd = curEpochLength;
        }

        return secondsSinceEpochEnd - curEpochLength;
    }

    /// @dev Gets epoch progress.
    /// @return Epoch progress.
    function getEpochProgress() external view returns (uint256) {
        uint256 curEpoch = currentEpoch;
        // Get seconds since last epoch end
        uint256 secondsSinceEpochEnd = block.timestamp - epochPoints[curEpoch - 1].endTime;

        uint256 curEpochLength = epochPoints[curEpoch].length;
        // If more seconds have passed compared to defined epoch length, limit by epoch length
        if (secondsSinceEpochEnd > curEpochLength) {
            secondsSinceEpochEnd = curEpochLength;
        }

        return (secondsSinceEpochEnd * 100) / curEpochLength;
    }

    /// @dev Gets total unclaimed rewards.
    /// @return Total unclaimed rewards.
    function getTotalUnclaimed() external view returns (uint256) {
        uint256 claimEpoch = currentEpoch - 1;
        return epochPoints[claimEpoch].availableRewards - epochPoints[claimEpoch].totalClaimed;
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

    /// @dev Receive function.
    receive() external payable {}
}
