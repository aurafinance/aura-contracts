// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IBalancerVault, IPriceOracle, IAsset } from "../../interfaces/balancer/IBalancerCore.sol";
import { IFeeDistributor } from "../../interfaces/balancer/IFeeDistributor.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";

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

interface IHiddenHand {
    function setRewardForwarding(address to) external;
}

contract VeBalGrant {
    using SafeERC20 for IERC20;
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

    address public immutable hiddenHand;

    bool public active;

    IBalancerVault public immutable BALANCER_VAULT;

    bytes32 public immutable BAL_ETH_POOL_ID;

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
        address _balancer,
        address _hiddenHand,
        IBalancerVault _balancerVault,
        bytes32 _balETHPoolId
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
        hiddenHand = _hiddenHand;
        BALANCER_VAULT = _balancerVault;
        BAL_ETH_POOL_ID = _balETHPoolId;
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

    modifier whileInactive() {
        require(!active, "active");
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
    function redeem() external onlyAuth whileInactive {
        _exitBalEthPool();
    }

    /// @notice Release veBAL lock
    function release() external onlyAuth whileInactive {
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
    function forwardIncentives(address _to) external {
        if (active) {
            require(msg.sender == project);
        } else {
            require(msg.sender == balancer);
        }

        IHiddenHand(hiddenHand).setRewardForwarding(_to);
    }

    /* ----------------------------------------------------------------
       Balancer Functions 
    ---------------------------------------------------------------- */

    /// @notice Queue a release to stop any new locks
    function setActive(bool _active) external onlyBalancer {
        active = _active;
    }

    function fundGrant(uint256 _amount) external onlyBalancer whileInactive {
        BAL.safeTransferFrom(balancer, address(this), _amount);
        active = true;
    }

    /* ----------------------------------------------------------------
       Internal Functions 
    ---------------------------------------------------------------- */

    function _joinBalEthPool() internal {
        IAsset[] memory assets = new IAsset[](2);
        assets[0] = IAsset(address(BAL));
        assets[1] = IAsset(address(WETH));
        uint256[] memory maxAmountsIn = new uint256[](2);
        maxAmountsIn[0] = BAL.balanceOf(address(this));
        maxAmountsIn[1] = WETH.balanceOf(address(this));

        BALANCER_VAULT.joinPool(
            BAL_ETH_POOL_ID,
            address(this),
            address(this),
            IBalancerVault.JoinPoolRequest(
                assets,
                maxAmountsIn,
                abi.encode(IBalancerVault.JoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT, maxAmountsIn, 0),
                false // Don't use internal balances
            )
        );
    }

    function _exitBalEthPool() internal {
        IAsset[] memory assets = new IAsset[](2);
        assets[0] = IAsset(address(BAL));
        assets[1] = IAsset(address(WETH));
        uint256[] memory minAmountsOut = new uint256[](2);
        uint256 balance = BAL_ETH_BPT.balanceOf(address(this));

        BALANCER_VAULT.exitPool(
            BAL_ETH_POOL_ID,
            address(this),
            payable(address(this)),
            IBalancerVault.ExitPoolRequest(
                assets,
                minAmountsOut,
                abi.encode(IBalancerVault.ExitKind.EXACT_BPT_IN_FOR_TOKENS_OUT, balance),
                false // Don't use internal balances
            )
        );
    }

    function _increaseLock(uint256 amount) internal {
        BAL_ETH_BPT.approve(address(votingEscrow), amount);
        votingEscrow.increase_amount(amount);
    }
}
