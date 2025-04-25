//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "hardhat/console.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
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
}

contract DerolasStaking is ReentrancyGuard, Ownable {
    using EnumerableSet for EnumerableSet.AddressSet;
    using SafeERC20 for IERC20;

    address public immutable balancerRouter;
    address public immutable poolId;
    uint8 public immutable assetsInPool;
    uint8 public immutable wethIndex;
    uint8 public immutable olasIndex;

    address public incentiveTokenAddress;

    uint256 public immutable minimumDonation;
    uint256 public epochRewards = 100_000_000;
    uint256 public lastAuctionBlock;
    uint256 public immutable epochLength = 6500;

    uint256 public totalDonated;
    uint256 public totalClaimed;
    uint256 public totalUnclaimed;


    uint8 public currentEpoch = 0;
    uint8 public constant maxDonatorsPerEpoch = 8;

    mapping(uint8=> mapping (address=> uint256)) public epochToDonations;
    mapping(uint8=> mapping (address=> uint256)) public epochToClaimable;
    mapping(uint8=> mapping (address=> uint256)) public epochToClaimed;

    mapping(uint8=> uint256) public epochToTotalClaimed;
    mapping(uint8=> uint256) public epochToTotalUnclaimed;
    mapping(uint8=> uint256) public epochToTotalDonated;


    event AgentRegistered(address indexed agentAddress, uint256 indexed agentId);
    event DonationReceived(address indexed donatorAddress, uint256 indexed amount);
    event AuctionEnded(uint256 indexed epochRewards);
    event UnclaimedRewardsDonated(uint256 indexed amount);
    event RewardsClaimed(address indexed agentAddress, uint256 indexed amount);

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
    }

    receive() external payable {}

    function incentiveBalance() public view returns (uint256) {
        return IERC20(incentiveTokenAddress).balanceOf(address(this));
    }

    function canPlayGame() public view returns (bool) {
        return IERC20(incentiveTokenAddress).balanceOf(address(this)) >= epochRewards;
    }

    function canPayTicket(uint256 claimAmount) public view returns (bool) {
        return IERC20(incentiveTokenAddress).balanceOf(address(this)) >= claimAmount;
    }

    modifier onlyOncePerEpoch() {
        require(block.number > lastAuctionBlock + epochLength, "Epoch not over");
        _;
        lastAuctionBlock = block.number;
    }

    // function registerAgent() external {
    //     require(!registeredAgents[msg.sender], "Already registered");
    //     registeredAgents[msg.sender] = true;
    //     emit AgentRegistered(msg.sender, 0);
    // }



    // function getClaimable(address _address) external view returns (uint256) {
    //     return claimable[_address];
    // }
   


    // Function to take a value of donation and return the share of the incentives
    // if the donation is less than the minimum donation, revert
    // if the donation is greater than the minimum donation, return the share
    // if the there are no donations, return all
    function estimateTicketPercentage(uint256 donation) public view returns (uint256) {
        require(donation >= minimumDonation, "Minimum donation not met");
        require(canPlayGame(), "Not enough OLAS rewards to play the game");
        if (totalDonated == 0) {
            return 1e18;
        }
        return (donation * 1e18) / totalDonated;
    }

    function endEpoch() external onlyOncePerEpoch nonReentrant {
        storeGame();
        advanceEpoch();
        emit AuctionEnded(epochRewards);
    }

    function advanceEpoch() internal {
        if (totalUnclaimed > 0) {
            // If there are unclaimed rewards, donate them
            donateUnclaimedRewards();
        }
        // Clear the donatorList and claimableList
        currentEpoch += 1;
        totalUnclaimed = 0;
        totalClaimed = 0;
        totalDonated = 0;
    }

    function storeGame() internal {
        // Store the game data
        epochToTotalClaimed[currentEpoch] = totalClaimed;
        epochToTotalUnclaimed[currentEpoch] = totalUnclaimed;
        epochToTotalDonated[currentEpoch] = totalDonated;

    }



    function donateUnclaimedRewards() internal {
        uint256[] memory amountsIn = new uint256[](assetsInPool);
        amountsIn[olasIndex] = totalUnclaimed;
        IERC20 token = IERC20(incentiveTokenAddress);
        token.approve(balancerRouter, 0);
        token.approve(balancerRouter, totalUnclaimed);
        IBalancerRouter(balancerRouter).donate(
            poolId,
            amountsIn,
            true,
            ""
        );
        totalUnclaimed = 0;
        emit UnclaimedRewardsDonated(totalUnclaimed);
    }

    function claim() external nonReentrant {
        uint256 amount = epochToClaimable[currentEpoch - 1][msg.sender];
        require(amount > 0, "Nothing to claim");
        require(canPayTicket(amount), "Not enough OLAS rewards to pay the ticket");


        // // Use direct transfer instead of safeTransfer
        IERC20(incentiveTokenAddress).transfer(msg.sender, amount);

        // we update the claimed amount
        epochToClaimed[currentEpoch - 1][msg.sender] += amount;
        epochToClaimable[currentEpoch - 1][msg.sender] = 0;
        totalClaimed += amount;
        totalUnclaimed -= amount;
        emit RewardsClaimed(msg.sender, amount);
    }


    function donate() external payable nonReentrant {
        require(msg.value >= minimumDonation, "Donation amount is less than the minimum donation");
        require(canPlayGame(), "Not enough OLAS rewards to play the game");
        require(epochToDonations[currentEpoch][msg.sender] == 0, "Already donated this epoch");
        require(epochToTotalDonated[currentEpoch] < maxDonatorsPerEpoch, "Max donators reached for this epoch");
        require(epochToClaimable[currentEpoch][msg.sender] == 0, "Have not claimed yet");

        totalDonated += msg.value;
        epochToDonations[currentEpoch][msg.sender] = msg.value;

        emit DonationReceived(msg.sender, msg.value);
    // }

    }
    function getCurrentShare(address _address) public view returns (uint256) {
        uint256 donation = epochToDonations[currentEpoch][_address];
        if (donation == 0) {
            return 0;
        }
        return estimateTicketPercentage(donation);
    }

}