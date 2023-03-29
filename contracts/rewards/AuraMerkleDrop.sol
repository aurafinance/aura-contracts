// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { MerkleProof } from "@openzeppelin/contracts-0.8/utils/cryptography/MerkleProof.sol";
import { IAuraLocker } from "../interfaces/IAuraLocker.sol";
import { AuraMath } from "../utils/AuraMath.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts-0.8/security/ReentrancyGuard.sol";

/**
 * @title   AuraMerkleDrop
 * @dev     Forked from convex-platform/contracts/contracts/MerkleAirdrop.sol. Changes:
 *            - solc 0.8.11 & OpenZeppelin MerkleDrop
 *            - Delayed start w/ trigger
 *            - EndTime for withdrawal to treasuryDAO
 *            - Penalty on claim & AuraLocker lock (only if address(auraLocker) != 0)
 *            - Non custodial (cannot change root)
 */
contract AuraMerkleDrop {
    using SafeERC20 for IERC20;

    address public dao;
    bytes32 public merkleRoot;

    IERC20 public immutable aura;
    IAuraLocker public auraLocker;

    address public immutable penaltyForwarder;
    uint256 public pendingPenalty = 0;

    uint256 public immutable deployTime;
    uint256 public startTime;
    uint256 public immutable expiryTime;

    mapping(address => bool) public hasClaimed;

    event DaoSet(address newDao);
    event RootSet(bytes32 newRoot);
    event StartedEarly();
    event ExpiredWithdrawn(uint256 amount);
    event LockerSet(address newLocker);
    event Claimed(address addr, uint256 amt, bool locked);
    event PenaltyForwarded(uint256 amount);
    event Rescued();

    /**
     * @param _dao              The Aura Dao
     * @param _merkleRoot       Merkle root
     * @param _aura             Aura token
     * @param _auraLocker       Aura locker contract
     * @param _penaltyForwarder PenaltyForwarded contract
     * @param _startDelay       Delay until claim is live
     * @param _expiresAfter     Timestamp claim expires
     */
    constructor(
        address _dao,
        bytes32 _merkleRoot,
        address _aura,
        address _auraLocker,
        address _penaltyForwarder,
        uint256 _startDelay,
        uint256 _expiresAfter
    ) {
        require(_dao != address(0), "!dao");
        dao = _dao;
        merkleRoot = _merkleRoot;
        require(_aura != address(0), "!aura");
        aura = IERC20(_aura);
        auraLocker = IAuraLocker(_auraLocker);

        penaltyForwarder = _penaltyForwarder;
        deployTime = block.timestamp;
        startTime = block.timestamp + _startDelay;

        require(_expiresAfter > 2 weeks, "!expiry");
        expiryTime = startTime + _expiresAfter;
    }

    /***************************************
                    CONFIG
    ****************************************/

    function setDao(address _newDao) external {
        require(msg.sender == dao, "!auth");
        dao = _newDao;
        emit DaoSet(_newDao);
    }

    function setRoot(bytes32 _merkleRoot) external {
        require(msg.sender == dao, "!auth");
        require(merkleRoot == bytes32(0), "already set");
        merkleRoot = _merkleRoot;
        emit RootSet(_merkleRoot);
    }

    /**
     * @notice This function is used to start the early process.
     * @dev This function requires that the message sender is the DAO and will set the start time to the current block timestamp. It will also emit the StartedEarly event.
     */
    function startEarly() external {
        require(msg.sender == dao, "!auth");
        startTime = block.timestamp;
        emit StartedEarly();
    }

    /**
     * @notice This function allows the DAO to withdraw the amount of tokens that have expired.
     * @dev This function requires the sender to be the DAO, and that the current block timestamp is greater than the expiry time. The amount of tokens withdrawn is the balance of the contract minus the pending penalty. The tokens are then transferred to the DAO, and an event is emitted.
     */
    function withdrawExpired() external {
        require(msg.sender == dao, "!auth");
        require(block.timestamp > expiryTime, "!expired");
        uint256 amt = aura.balanceOf(address(this)) - pendingPenalty;
        aura.safeTransfer(dao, amt);
        emit ExpiredWithdrawn(amt);
    }

    /**
     * @notice Sets the locker address to the given address.
     * @dev Only the DAO can call this function.
     * @param _newLocker The address of the new locker.
     */
    function setLocker(address _newLocker) external {
        require(msg.sender == dao, "!auth");
        auraLocker = IAuraLocker(_newLocker);
        emit LockerSet(_newLocker);
    }

    /**
     * @notice This function allows the DAO to rescue the reward tokens from the contract.
     * @dev This function requires the sender to be the DAO, and the block timestamp to be before the deployment time plus one week or the start time, whichever is earlier. It then transfers the balance of the contract to the DAO.
     */
    function rescueReward() public {
        require(msg.sender == dao, "!auth");
        require(block.timestamp < AuraMath.min(deployTime + 1 weeks, startTime), "too late");

        uint256 amt = aura.balanceOf(address(this));
        aura.safeTransfer(dao, amt);

        emit Rescued();
    }

    /***************************************
                    CLAIM
    ****************************************/

    function claim(
        bytes32[] calldata _proof,
        uint256 _amount,
        bool _lock
    ) public returns (bool) {
        require(merkleRoot != bytes32(0), "!root");
        require(block.timestamp > startTime, "!started");
        require(block.timestamp < expiryTime, "!active");
        require(_amount > 0, "!amount");
        require(hasClaimed[msg.sender] == false, "already claimed");

        bytes32 leaf = keccak256(abi.encodePacked(msg.sender, _amount));
        require(MerkleProof.verify(_proof, merkleRoot, leaf), "invalid proof");

        hasClaimed[msg.sender] = true;

        if (_lock) {
            aura.safeApprove(address(auraLocker), 0);
            aura.safeApprove(address(auraLocker), _amount);
            auraLocker.lock(msg.sender, _amount);
        } else {
            // If there is an address for auraLocker, and not locking, apply 20% penalty
            uint256 penalty = address(penaltyForwarder) == address(0) || address(auraLocker) == address(0)
                ? 0
                : (_amount * 3) / 10;
            pendingPenalty += penalty;
            aura.safeTransfer(msg.sender, _amount - penalty);
        }

        emit Claimed(msg.sender, _amount, _lock);
        return true;
    }

    /***************************************
                    FORWARD
    ****************************************/

    /**
     * @notice This function forwards the pending penalty to the penalty forwarder.
     * @dev The function sets the pending penalty to 0 and then transfers the amount to the penalty forwarder.
     * It then emits an event PenaltyForwarded with the amount transferred.
     */
    function forwardPenalty() public {
        uint256 toForward = pendingPenalty;
        pendingPenalty = 0;
        aura.safeTransfer(penaltyForwarder, toForward);
        emit PenaltyForwarded(toForward);
    }
}
