// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts-0.8/security/ReentrancyGuard.sol";

interface IVoterProxy {
    function execute(
        address _to,
        uint256 _value,
        bytes calldata _data
    ) external returns (bool, bytes memory);
}

interface IVotingEscrow {
    function withdraw() external;
}

interface IAuraRedemption {
    function expiry() external view returns (uint256);

    function redeemableTokensLength() external view returns (uint256);

    function redeemableTokens(uint256 _index) external view returns (address);

    function sweep(address _token, address _to) external;

    function setOwner(address _owner) external;
}

interface IFinalizable {
    function finalize(address[] calldata _tokens) external;

    function setOwner(address _owner) external;
}

/**
 * @title   WindDownCoordinator
 * @notice  Orchestrates the Stage 2 wind-down once the Booster is shut down
 *          and this contract has been granted VoterProxy owner + operator
 *          and ownership of the three redemption contracts.
 *
 *          Flow:
 *            1. unlockAndWithdraw()   — pull BPT out of veBAL into this contract
 *            2. splitAndFinalize()    — sweep residuals, split BPT 90/10,
 *                                       finalize both stage-2 contracts
 *
 *          A generic onlyOwner `execute` is kept for escape hatches (rotate
 *          VoterProxy owner/operator, rotate redemption contract owners,
 *          recover stray tokens).
 */
contract WindDownCoordinator is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS_DENOMINATOR = 10_000;

    IVoterProxy public immutable voterProxy;
    IVotingEscrow public immutable votingEscrow;
    IERC20 public immutable crvBpt;
    IAuraRedemption public immutable auraRedemption;
    IFinalizable public immutable rAuraRedemption;
    IFinalizable public immutable auraBalRedemption;
    uint256 public immutable auraBalBps;

    enum Stage {
        UNSTARTED,
        WITHDRAWN,
        FINALIZED
    }

    Stage public stage;
    address public owner;

    event Withdrawn(uint256 bptAmount);
    event SplitAndFinalized(uint256 auraBalBpt, uint256 rAuraBpt, address[] residuals);
    event Executed(address indexed target, uint256 value, bytes data, bytes result);
    event OwnerSet(address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "!owner");
        _;
    }

    constructor(
        address _voterProxy,
        address _votingEscrow,
        address _crvBpt,
        address _auraRedemption,
        address _rAuraRedemption,
        address _auraBalRedemption,
        uint256 _auraBalBps,
        address _owner
    ) {
        require(_voterProxy != address(0), "!voterProxy");
        require(_votingEscrow != address(0), "!votingEscrow");
        require(_crvBpt != address(0), "!crvBpt");
        require(_auraRedemption != address(0), "!auraRedemption");
        require(_rAuraRedemption != address(0), "!rAuraRedemption");
        require(_auraBalRedemption != address(0), "!auraBalRedemption");
        require(_auraBalBps > 0 && _auraBalBps < BPS_DENOMINATOR, "!bps");
        require(_owner != address(0), "!owner");

        voterProxy = IVoterProxy(_voterProxy);
        votingEscrow = IVotingEscrow(_votingEscrow);
        crvBpt = IERC20(_crvBpt);
        auraRedemption = IAuraRedemption(_auraRedemption);
        rAuraRedemption = IFinalizable(_rAuraRedemption);
        auraBalRedemption = IFinalizable(_auraBalRedemption);
        auraBalBps = _auraBalBps;
        owner = _owner;
    }

    /**
     * @notice Withdraw the BPT from the veBAL lock via the VoterProxy and
     *         pull it into this contract. The VotingEscrow reverts on its
     *         own if the lock has not expired.
     */
    function unlockAndWithdraw() external onlyOwner nonReentrant {
        require(stage == Stage.UNSTARTED, "!stage");

        voterProxy.execute(address(votingEscrow), 0, abi.encodeWithSelector(IVotingEscrow.withdraw.selector));

        uint256 bptBal = crvBpt.balanceOf(address(voterProxy));
        require(bptBal > 0, "!bpt");

        voterProxy.execute(address(crvBpt), 0, abi.encodeWithSelector(IERC20.transfer.selector, address(this), bptBal));

        stage = Stage.WITHDRAWN;
        emit Withdrawn(bptBal);
    }

    /**
     * @notice Sweep residual treasury tokens from AuraRedemption into
     *         RAuraRedemption, split the BPT by `auraBalBps` into the two
     *         stage-2 contracts, and finalize both. The coordinator filters
     *         the Stage-2 token lists down to tokens with a positive live
     *         balance so fully claimed residuals do not brick finalization.
     */
    function splitAndFinalize() external onlyOwner nonReentrant {
        require(stage == Stage.WITHDRAWN, "!stage");
        require(block.timestamp >= auraRedemption.expiry(), "!expired");

        uint256 residualsLen = auraRedemption.redeemableTokensLength();
        address[] memory residuals = new address[](residualsLen);
        uint256 residualCount;
        for (uint256 i = 0; i < residualsLen; i++) {
            address t = auraRedemption.redeemableTokens(i);
            auraRedemption.sweep(t, address(rAuraRedemption));
            if (IERC20(t).balanceOf(address(rAuraRedemption)) > 0) {
                residuals[residualCount] = t;
                residualCount++;
            }
        }

        uint256 total = crvBpt.balanceOf(address(this));
        require(total > 0, "!bpt");
        uint256 auraBalShare = (total * auraBalBps) / BPS_DENOMINATOR;
        uint256 rAuraShare = total - auraBalShare;

        if (auraBalShare > 0) {
            crvBpt.safeTransfer(address(auraBalRedemption), auraBalShare);
        }
        if (rAuraShare > 0) {
            crvBpt.safeTransfer(address(rAuraRedemption), rAuraShare);
        }

        address[] memory auraBalTokens = new address[](1);
        auraBalTokens[0] = address(crvBpt);
        auraBalRedemption.finalize(auraBalTokens);

        address[] memory rAuraTokens = new address[](residualCount + 1);
        rAuraTokens[0] = address(crvBpt);
        for (uint256 i = 0; i < residualCount; i++) {
            rAuraTokens[i + 1] = residuals[i];
        }
        rAuraRedemption.finalize(rAuraTokens);

        address[] memory emittedResiduals = new address[](residualCount);
        for (uint256 i = 0; i < residualCount; i++) {
            emittedResiduals[i] = residuals[i];
        }

        stage = Stage.FINALIZED;
        emit SplitAndFinalized(auraBalShare, rAuraShare, emittedResiduals);
    }

    /**
     * @notice Generic escape hatch. Used for rotating VoterProxy owner /
     *         operator, rotating ownership of the redemption contracts,
     *         recovering stray tokens, or any other one-off the multisig
     *         needs. Only the coordinator owner can call.
     */
    function execute(
        address _target,
        uint256 _value,
        bytes calldata _data
    ) external payable onlyOwner returns (bytes memory) {
        (bool ok, bytes memory ret) = _target.call{ value: _value }(_data);
        require(ok, "!success");
        emit Executed(_target, _value, _data, ret);
        return ret;
    }

    function setOwner(address _owner) external onlyOwner {
        require(_owner != address(0), "!owner");
        owner = _owner;
        emit OwnerSet(_owner);
    }

    receive() external payable {}
}
