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

    EnumerableSet.AddressSet private donatorList;
    EnumerableSet.AddressSet private claimableList;

    uint256 public totalDonated;
    uint256 public totalClaimed;
    uint256 public totalUnclaimed;

    mapping(address => bool) public registeredAgents;
    mapping(address => uint256) public donators;
    mapping(address => uint256) public claimable;

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

    function isRegistered(address _address) public view returns (bool) {
        return registeredAgents[_address];
    }

    function donate() external payable nonReentrant {
        require(msg.value >= minimumDonation, "Minimum donation not met");
        require(canPlayGame(), "Not enough OLAS rewards to play the game");

        donators[msg.sender] += msg.value;
        totalDonated += msg.value;
        donatorList.add(msg.sender);

        uint256[] memory amountsIn = new uint256[](assetsInPool);
        amountsIn[wethIndex] = msg.value;

        IBalancerRouter(balancerRouter).donate{value: msg.value}(
            poolId,
            amountsIn,
            true,
            ""
        );

        emit DonationReceived(msg.sender, msg.value);
    }

    function registerAgent() external {
        require(!registeredAgents[msg.sender], "Already registered");
        registeredAgents[msg.sender] = true;
        emit AgentRegistered(msg.sender, 0);
    }

    function getCurrentShare(address _address) public view returns (uint256) {
        return (donators[_address] * 1e18) / totalDonated;
    }

    function getClaimable(address _address) external view returns (uint256) {
        return claimable[_address];
    }

    function endAuction() external onlyOncePerEpoch nonReentrant {
        donateUnclaimedRewards();

        for (uint256 i = 0; i < donatorList.length(); i++) {
            address donator = donatorList.at(i);
            uint256 share = getCurrentShare(donator);
            uint256 reward = (epochRewards * share) / 1e18;
            claimable[donator] += reward;
            claimableList.add(donator);
            donators[donator] = 0;
        }

        // FIX: Create a temporary array to store all addresses before clearing the set
        address[] memory allDonators = new address[](donatorList.length());
        for (uint256 i = 0; i < donatorList.length(); i++) {
            allDonators[i] = donatorList.at(i);
        }
        
        // Remove each address from the set
        for (uint256 i = 0; i < allDonators.length; i++) {
            donatorList.remove(allDonators[i]);
        }

        totalDonated = 0;
        emit AuctionEnded(epochRewards);
    }

    function donateUnclaimedRewards() internal {
        uint256 totalUnclaimedLocal;

        while (claimableList.length() > 0) {
            address donator = claimableList.at(0);
            totalUnclaimedLocal += claimable[donator];
            claimable[donator] = 0;
            claimableList.remove(donator);
        }

        totalUnclaimed = totalUnclaimedLocal;

        if (totalUnclaimedLocal > 0) {
            uint256[] memory amountsIn = new uint256[](assetsInPool);
            amountsIn[olasIndex] = totalUnclaimedLocal;

            // Use direct approve method instead of SafeERC20
            IERC20 token = IERC20(incentiveTokenAddress);
            // First reset approval to 0
            token.approve(balancerRouter, 0);
            // Then set to desired amount
            token.approve(balancerRouter, totalUnclaimedLocal);

            IBalancerRouter(balancerRouter).donate(
                poolId,
                amountsIn,
                true,
                ""
            );

            emit UnclaimedRewardsDonated(totalUnclaimedLocal);
        }

        totalDonated = 0;
    }

    function claim() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        require(amount > 0, "Nothing to claim");
        require(canPayTicket(amount), "Not enough OLAS rewards to pay the ticket");

        claimable[msg.sender] = 0;
        claimableList.remove(msg.sender);

        // Use direct transfer instead of safeTransfer
        IERC20(incentiveTokenAddress).transfer(msg.sender, amount);

        emit RewardsClaimed(msg.sender, amount);
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
}