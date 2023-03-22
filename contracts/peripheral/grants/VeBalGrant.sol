// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IFeeDistributor } from "../interfaces/balancer/IFeeDistributor.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";

// prettier-ignore
interface IVotingEscrow {
    function create_lock(uint256, uint256) external;
    function increase_amount(uint256) external;
    function increase_unlock_time(uint256) external;
    function withdraw() external;
}

interface IBalGaugeController {
    function vote_for_gauge_weights(address, uint256) external;
}

interface IBalMinter {
    function mint(address) external;
}

contract VeBalGrant {
    /* ----------------------------------------------------------------
       Storage 
    ---------------------------------------------------------------- */

    IERC20 public immutable WETH;

    IERC20 public immutable BAL;

    IERC20 public immutable BAL_ETH_BPT;

    IVotingEscrow public immutable votingEscrow;

    IBalGaugeController public immutable gaugeController;

    IBalMinter public immutable balMinter;

    address public immutable veBalGauge;

    address public immutable project;

    address public immutable balancer;

    bool public active;

    /* ----------------------------------------------------------------
       Constructor 
    ---------------------------------------------------------------- */

    constructor(
        address _weth,
        address _bal,
        address _balEthBpt,
        address _votingEscrow,
        address _gaugeController,
        address _balMinter,
        address _veBalGauge,
        address _project,
        address _balancer
    ) {
        WETH = IERC20(_weth);
        BAL = IERC20(_bal);
        BAL_ETH_BPT = IERC20(_balEthBpt);
        votingEscrow = IVotingEscrow(_votingEscrow);
        gaugeController = IBalGaugeController(_gaugeController);
        balMinter = IBalMinter(_balMinter);
        veBalGauge = _veBalGauge;
        project = _project;
        balancer = _balancer;
        active = true;
    }

    /* ----------------------------------------------------------------
       Modifiers 
    ---------------------------------------------------------------- */

    modifier onlyAuth() {
        require(msg.sender == project || msg.sender == balancer, "!auth");
        _;
    }

    modifier onlyProject() {
        require(msg.sender == project, "!project");
        _;
    }

    modifier onlyBalancer() {
        require(msg.sender == balancer, "!balancer");
        _;
    }

    modifier whileActive() {
        require(active, "!active");
        _;
    }

    /* ----------------------------------------------------------------
       Shared Functions
    ---------------------------------------------------------------- */

    /// @notice Increate amount locked in veBAL
    function increaseLock(uint256 amount) external onlyAuth whileActive {
        _increaseLock(amount);
    }

    /// @notice Increase veBAL lock time
    function increaseTime(uint256 to) external onlyAuth whileActive {
        votingEscrow.increase_unlock_time(to);
    }

    // @notice Exit BPT for BAL ETH
    function redeem() external onlyAuth {
        // TODO: exit bal eth pool
    }

    /// @notice Release veBAL lock
    function release() external onlyAuth {
        votingEscrow.withdraw();
    }

    /// @notice Create the initial lock
    function createLock(uint256 unlockTime) external onlyAuth whileActive {
        _joinBalEthPool();
        uint256 balance = BAL_ETH_BPT.balanceOf(address(this));
        BAL_ETH_BPT.approve(address(votingEscrow), balance);
        votingEscrow.create_lock(balance, unlockTime);
    }

    /// @notice Claim BAL from the veBAL gauge
    function claimBalAndLock(address to) external onlyAuth whileActive {
        balMinter.mint(veBalGauge);
        _joinBalEthPool();
        uint256 balance = BAL_ETH_BPT.balanceOf(address(this));
        _increaseLock(balance);
    }

    function setApprovals() external onlyAuth {
        WETH.approve(project, type(uint256).max);
        BAL.approve(balancer, type(uint256).max);
    }

    /* ----------------------------------------------------------------
       Project Functions
    ---------------------------------------------------------------- */

    /// @notice Vote for a gauge weight
    function voteGaugeWeight(address gauge, uint256 weight) external {
        if (active) {
            require(msg.sender == project);
        } else {
            require(msg.sender == balancer);
        }
        gaugeController.vote_for_gauge_weights(gauge, weight);
    }

    /// @notice Claim fees
    function claimFees(
        address distro,
        address token,
        address to
    ) external onlyProject whileActive {
        require(token != address(BAL) && token != address(WETH), "!token");
        IFeeDistributor(distro).claimToken(address(this), IERC20(token));
        IERC20(token).transfer(to, IERC20(token).balanceOf(address(this)));
    }

    /// @notice Forward HH voting incentives
    function forwardIncentives() external {
        if (active) {
            require(msg.sender == project);
        } else {
            require(msg.sender == balancer);
        }

        // TODO:
    }

    /* ----------------------------------------------------------------
       Balancer Functions 
    ---------------------------------------------------------------- */

    /// @notice Queue a release to stop any new locks
    function setActive(bool _active) external onlyBalancer {
        active = _active;
    }

    /* ----------------------------------------------------------------
       Internal Functions 
    ---------------------------------------------------------------- */

    function _joinBalEthPool() internal {
        // TODO:
    }

    function _increaseLock(uint256 amount) internal {
        BAL_ETH_BPT.approve(address(votingEscrow), amount);
        votingEscrow.increase_amount(amount);
    }
}
