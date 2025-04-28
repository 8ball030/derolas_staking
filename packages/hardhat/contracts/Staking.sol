//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

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

interface IPermit2 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}


contract DerolasStaking is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;


    IPermit2 public immutable permit2;

    address public immutable balancerRouter;
    address public immutable poolId;
    uint8 public immutable assetsInPool;
    uint8 public immutable wethIndex;
    uint8 public immutable olasIndex;
    address public immutable incentiveTokenAddress;

    uint256 public immutable minimumDonation;
    uint256 public immutable epochRewards = 8e17; // 1 OLAS
    uint256 public immutable epochLength = 90;

    uint256 public totalDonated;
    uint256 public totalClaimed;
    uint8 public currentEpoch = 0;

    uint8 public constant maxDonatorsPerEpoch = 8;

    mapping(uint8 => mapping(address => uint256)) public epochToDonations;
    mapping(uint8 => mapping(address => uint256)) public epochToClaimed;
    mapping(uint8 => uint256) public epochToTotalDonated;
    mapping(uint8 => uint256) public epochToEndBlock;
    mapping(uint8 => bool) public epochDonated;

    event DonationReceived(address indexed donatorAddress, uint256 indexed amount);
    event AuctionEnded(uint256 indexed epochRewards);
    event UnclaimedRewardsDonated(uint256 indexed amount);
    event RewardsClaimed(address indexed donatorAddress, uint256 indexed amount);
    event DerolasBought(uint256 indexed amount);


    receive() external payable {}

    function incentiveBalance() public view returns (uint256) {
        return IERC20(incentiveTokenAddress).balanceOf(address(this));
    }

    function canPlayGame() public view returns (bool) {
        return incentiveBalance() >= epochRewards;
    }

    function canPayTicket(uint256 claimAmount) public view returns (bool) {
        return incentiveBalance() >= claimAmount;
    }

    modifier onlyOncePerEpoch() {
        require(block.number >= epochToEndBlock[currentEpoch], "Epoch not over");
        _;
    }

    modifier gameHasStarted() {
        require(currentEpoch > 0, "Game has not started yet");
        _;
    }


    function endEpoch() external onlyOncePerEpoch nonReentrant {
        require(currentEpoch > 0, "No epoch to end");
        require(block.number > epochToEndBlock[currentEpoch], "Epoch not over");
        donateEthContribution();
        _endEpoch();
    }


    function _endEpoch() internal {
        if (currentEpoch > 0) {
            uint8 claimEpoch = currentEpoch - 1;
            if (!epochDonated[claimEpoch] && block.number > epochToEndBlock[claimEpoch] ) {
                donateUnclaimedRewards(claimEpoch);
            }
        }

        storeGame();
        advanceEpoch();
        emit AuctionEnded(epochRewards);
    }

    function storeGame() internal {
        epochToTotalDonated[currentEpoch] = totalDonated;
    }

    function advanceEpoch() internal {
        currentEpoch += 1;
        totalDonated = 0;
        totalClaimed = 0;
        epochToEndBlock[currentEpoch] = block.number + epochLength;
    }

    function donateUnclaimedRewards(uint8 epoch) internal {
        uint256 totalEpochDonations = epochToTotalDonated[epoch];
        if (totalEpochDonations == 0) {
            epochDonated[epoch] = true;
            return;
        }

        uint256 unclaimedAmount = epochRewards - totalClaimed;
        if (unclaimedAmount == 0) {
            epochDonated[epoch] = true;
            return;
        }
        require(IERC20(incentiveTokenAddress).balanceOf(address(this)) >= unclaimedAmount, "Not enough incentive balance to donate");

        uint256[] memory amountsIn = new uint256[](assetsInPool);
        amountsIn[olasIndex] = unclaimedAmount;

        IERC20 token = IERC20(incentiveTokenAddress);
        token.approve(address(permit2), 0);
        token.approve(address(permit2), unclaimedAmount);
        permit2.approve(incentiveTokenAddress, balancerRouter, uint160(unclaimedAmount), uint48(block.timestamp + 1 days));
        IBalancerRouter(balancerRouter).donate(poolId, amountsIn, true, "");
        epochDonated[epoch] = true;
        emit UnclaimedRewardsDonated(unclaimedAmount);
    }
    function donateEthContribution() internal {
        // require(IERC20(incentiveTokenAddress).balanceOf(address(this)) >= unclaimedAmount, "Not enough incentive balance to donate");
        // we instead check the whole balance of the contract
        uint256 contributionAmount = address(this).balance;
        if (contributionAmount == 0) {
            return;
        }
        uint256[] memory amountsIn = new uint256[](assetsInPool);
        amountsIn[wethIndex] = contributionAmount;
        IBalancerRouter(balancerRouter).donate{value: contributionAmount}(poolId, amountsIn, true, "");
        emit DerolasBought(contributionAmount);
    }


    function claim() external nonReentrant {
        require(currentEpoch > 0, "No epoch to claim from");

        uint8 claimEpoch = currentEpoch - 1;
        require(epochToEndBlock[claimEpoch] > 0, "Epoch not ended yet");
        require(block.number <= epochToEndBlock[claimEpoch] + (2 * epochLength), "Claim window closed");
        require(epochToClaimed[claimEpoch][msg.sender] == 0, "Already claimed");

        uint256 donation = epochToDonations[claimEpoch][msg.sender];
        require(donation > 0, "No donation found");

        uint256 totalEpochDonations = epochToTotalDonated[claimEpoch];
        require(totalEpochDonations > 0, "No donations this epoch");

        uint256 amount = (donation * epochRewards) / totalEpochDonations;
        require(amount > 0, "Nothing to claim");
        require(canPayTicket(amount), "Not enough OLAS rewards");

        epochToClaimed[claimEpoch][msg.sender] = amount;

        IERC20(incentiveTokenAddress).transfer(msg.sender, amount);

        totalClaimed += amount;
        emit RewardsClaimed(msg.sender, amount);
    }

    function claimable(address _address) external view returns (uint256) {
        if (currentEpoch == 0) {
            return 0;
        }
        uint8 claimEpoch = currentEpoch - 1;
        if (epochToClaimed[claimEpoch][_address] > 0) {
            return 0;
        }

        uint256 donation = epochToDonations[claimEpoch][_address];
        uint256 totalEpochDonations = epochToTotalDonated[claimEpoch];

        if (donation == 0 || totalEpochDonations == 0) {
            return 0;
        }

        return (donation * epochRewards) / totalEpochDonations;
    }

    function estimateTicketPercentage(uint256 donation) public view returns (uint256) {
        require(donation >= minimumDonation, "Minimum donation not met");
        require(canPlayGame(), "Not enough OLAS rewards to play the game");

        if (totalDonated == 0) {
            return 1e18; // full share
        }

        return (donation * 1e18) / totalDonated;
    }

    function donate() external payable nonReentrant gameHasStarted {
        require(msg.value >= minimumDonation, "Donation amount is less than the minimum donation");
        require(canPlayGame(), "Not enough OLAS rewards to play the game");
        require(epochToDonations[currentEpoch][msg.sender] == 0, "Already donated this epoch");
        require(epochToTotalDonated[currentEpoch] < maxDonatorsPerEpoch, "Max donators reached");

        totalDonated += msg.value;
        epochToDonations[currentEpoch][msg.sender] = msg.value;

        emit DonationReceived(msg.sender, msg.value);
    }

    function topUpIncentiveBalance(uint256 amount) external {
        require(amount > 0, "Amount must be greater than 0");
        require(IERC20(incentiveTokenAddress).balanceOf(msg.sender) >= amount, "Not enough OLAS rewards");
        require(IERC20(incentiveTokenAddress).allowance(msg.sender, address(this)) >= amount, "Not enough allowance");

        IERC20(incentiveTokenAddress).safeTransferFrom(msg.sender, address(this), amount);
    }

    function getCurrentShare(address _address) public view returns (uint256) {
        uint256 donation = epochToDonations[currentEpoch][_address];
        if (donation == 0) {
            return 0;
        }
        return (donation * 1e18) / totalDonated;
    }

    function getEpochProgress() public view returns (uint256) {
        uint256 blocksSinceEnd = block.number - epochToEndBlock[currentEpoch];
        return (blocksSinceEnd * 100) / epochLength;
    }

    function getBlocksRemaining() public view returns (uint256) {
        if (currentEpoch == 0) {
            return 0;
        }
        if (block.number >= epochToEndBlock[currentEpoch]) {
            return 0;
        }
        uint256 blocksRemaining = epochToEndBlock[currentEpoch] - block.number;
        return blocksRemaining;
    }


    function getTotalDonated() public view returns (uint256) {
        return totalDonated;
    }

    function currentIncentiveBalance() public view returns (uint256) {
        return IERC20(incentiveTokenAddress).balanceOf(address(this));
    }

    function getEpochRewards() public view returns (uint256) {
        return epochRewards;
    }

    function getCurrentEpoch() public view returns (uint8) {
        return currentEpoch;
    }

    function getTotalClaimed() public view returns (uint256) {
        return totalClaimed;
    }

    /// @dev Gets service multisig nonces.
    /// @param multisig Service multisig address.
    /// @return nonces Current donations value.
    function getMultisigNonces(address multisig) external view virtual returns (uint256[] memory nonces) {
        nonces = new uint256[](1);
        // The nonce is equal to the total donations value
        nonces[0] = donators[multisig];
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
    function getEpochLength() public view returns (uint256) {
        return epochLength;
    }
    function getTotalUnclaimed() public view returns (uint256) {
        if (currentEpoch == 0) {
            return 0;
        }
        uint8 claimEpoch = currentEpoch - 1;
        if (epochDonated[claimEpoch]) {
            return 0;
        }
        uint256 totalEpochDonations = epochToTotalDonated[claimEpoch];
        if (totalEpochDonations == 0) {
            return 0;
        }
        return epochRewards - totalClaimed;
    }


    constructor(
        address _owner,
        uint256 _minimumDonation,
        address _balancerRouter,
        address _poolId,
        uint8 _assetsInPool,
        uint8 _wethIndex,
        uint8 _olasIndex,
        address _incentiveTokenAddress
    ) Ownable(_owner) {
        minimumDonation = _minimumDonation;
        balancerRouter = _balancerRouter;
        poolId = _poolId;
        assetsInPool = _assetsInPool;
        wethIndex = _wethIndex;
        olasIndex = _olasIndex;
        incentiveTokenAddress = _incentiveTokenAddress;
        epochToEndBlock[currentEpoch] = block.number + epochLength;
        permit2 = IPermit2(IBalancerRouter(_balancerRouter).getPermit2());
        _endEpoch();
        
    }
}
