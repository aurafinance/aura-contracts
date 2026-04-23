// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts-0.8/security/ReentrancyGuard.sol";

interface IAuraRedemption {
    function expiry() external view returns (uint256);

    function totalSupply() external view returns (uint256);
}

/**
 * @title   RAuraRedemption (Contract B)
 * @notice  Stage 2 wind-down exit for rAURA holders. rAURA is burned for a
 *          pro-rata share of 10% of BAL + WETH released from the veBAL lock
 *          plus any residual treasury swept from AuraRedemption.
 * @dev     Denominator is snapshotted at `finalize` from `rAura.totalSupply()`.
 *          Since AuraRedemption.expiry must have passed before `finalize`,
 *          no further rAURA can ever be minted, so the snapshot covers the
 *          complete holder set.
 */
contract RAuraRedemption is ReentrancyGuard {
    using SafeERC20 for IERC20;

    address private constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    IAuraRedemption public immutable auraRedemption;
    uint256 public immutable SWEEP_DELAY;

    uint256 public REDEEMABLE_RAURA_SUPPLY;
    uint256 public sweepAfter;

    address[] public redeemableTokens;
    mapping(address => uint256) public redeemableTokenAllocation;

    bool public finalized;
    address public owner;

    event Finalized(uint256 snapshotSupply, address[] tokens, uint256[] allocations);
    event Redeemed(address indexed user, uint256 rAuraBurned, uint256[] payouts);
    event Swept(address indexed token, address indexed to, uint256 amount);
    event OwnerSet(address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "!owner");
        _;
    }

    constructor(
        address _auraRedemption,
        uint256 _sweepDelay,
        address _owner
    ) {
        require(_auraRedemption != address(0), "!rAura");
        require(_sweepDelay > 0, "!delay");
        require(_owner != address(0), "!owner");

        auraRedemption = IAuraRedemption(_auraRedemption);
        SWEEP_DELAY = _sweepDelay;
        owner = _owner;
    }

    function redeemableTokensLength() external view returns (uint256) {
        return redeemableTokens.length;
    }

    /**
     * @notice Snapshot rAURA's total supply and every redeemable token's
     *         current balance. Gated until AuraRedemption's redemption
     *         window has closed. One-shot.
     */
    function finalize(address[] calldata _tokens) external onlyOwner {
        require(!finalized, "finalized");
        require(block.timestamp >= auraRedemption.expiry(), "!expired");
        require(_tokens.length > 0, "!tokens");

        uint256 supply = auraRedemption.totalSupply();
        require(supply > 0, "!supply");
        REDEEMABLE_RAURA_SUPPLY = supply;

        uint256[] memory allocs = new uint256[](_tokens.length);
        for (uint256 i = 0; i < _tokens.length; i++) {
            address t = _tokens[i];
            require(t != address(0) && t != address(auraRedemption), "!token");
            require(redeemableTokenAllocation[t] == 0, "dup");
            uint256 bal = IERC20(t).balanceOf(address(this));
            require(bal > 0, "!funded");
            redeemableTokenAllocation[t] = bal;
            allocs[i] = bal;
            redeemableTokens.push(t);
        }

        sweepAfter = block.timestamp + SWEEP_DELAY;
        finalized = true;
        emit Finalized(supply, _tokens, allocs);
    }

    /**
     * @notice Burn `_amount` rAURA and receive the pro-rata share of every
     *         token in `redeemableTokens`.
     */
    function redeem(uint256 _amount) external nonReentrant returns (uint256[] memory payouts) {
        require(finalized, "!finalized");
        require(_amount > 0, "!amount");

        IERC20(address(auraRedemption)).safeTransferFrom(msg.sender, BURN_ADDRESS, _amount);

        uint256 len = redeemableTokens.length;
        payouts = new uint256[](len);
        for (uint256 i = 0; i < len; i++) {
            address t = redeemableTokens[i];
            uint256 payout = (_amount * redeemableTokenAllocation[t]) / REDEEMABLE_RAURA_SUPPLY;
            payouts[i] = payout;
            if (payout > 0) {
                IERC20(t).safeTransfer(msg.sender, payout);
            }
        }

        emit Redeemed(msg.sender, _amount, payouts);
    }

    function sweep(address _token, address _to) external onlyOwner {
        require(finalized, "!finalized");
        require(block.timestamp >= sweepAfter, "!sweep");
        require(_to != address(0), "!to");
        uint256 bal = IERC20(_token).balanceOf(address(this));
        IERC20(_token).safeTransfer(_to, bal);
        emit Swept(_token, _to, bal);
    }

    function setOwner(address _owner) external onlyOwner {
        require(_owner != address(0), "!owner");
        owner = _owner;
        emit OwnerSet(_owner);
    }
}
