// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts-0.8/security/ReentrancyGuard.sol";

/**
 * @title   BaseRedemption
 * @notice  Shared logic for the three wind-down redemption contracts. Holds
 *          the owner / finalize / sweep / redeem skeleton; subclasses
 *          override virtual hooks to specialise:
 *            - `_burnable()`        — the ERC20 each caller burns on redeem
 *            - `_denominator()`     — the pro-rata denominator
 *            - `_onBeforeFinalize` / `_onAfterFinalize` — subclass-specific
 *              finalize-time checks and state (e.g. snapshot supply, set
 *              sweep timer)
 *            - `_onBeforeRedeem` / `_onAfterRedeem` — extra redeem checks
 *              and post-redeem side-effects (e.g. minting a receipt token)
 *            - `_requireCanSweep()` — when `sweep` is permitted
 */
abstract contract BaseRedemption is ReentrancyGuard {
    using SafeERC20 for IERC20;

    address internal constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    address[] public redeemableTokens;
    mapping(address => uint256) public redeemableTokenAllocation;
    bool public finalized;
    address public owner;

    event Finalized(uint256 denominator, address[] tokens, uint256[] allocations);
    event Redeemed(address indexed user, uint256 burned, uint256[] payouts);
    event Swept(address indexed token, address indexed to, uint256 amount);
    event OwnerSet(address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "!owner");
        _;
    }

    constructor(address _owner) {
        require(_owner != address(0), "!owner");
        owner = _owner;
    }

    function redeemableTokensLength() external view returns (uint256) {
        return redeemableTokens.length;
    }

    /**
     * @notice Snapshot the current balance of each token as its allocation.
     *         Must be called while the contract is fully funded. One-shot.
     */
    function finalize(address[] calldata _tokens) external onlyOwner {
        require(!finalized, "finalized");
        require(_tokens.length > 0, "!tokens");
        _onBeforeFinalize();

        IERC20 burnable = _burnable();
        uint256[] memory allocs = new uint256[](_tokens.length);
        for (uint256 i = 0; i < _tokens.length; i++) {
            address t = _tokens[i];
            require(t != address(0) && t != address(burnable), "!token");
            require(redeemableTokenAllocation[t] == 0, "dup");
            uint256 bal = IERC20(t).balanceOf(address(this));
            require(bal > 0, "!funded");
            redeemableTokenAllocation[t] = bal;
            allocs[i] = bal;
            redeemableTokens.push(t);
        }

        finalized = true;
        _onAfterFinalize();
        emit Finalized(_denominator(), _tokens, allocs);
    }

    /**
     * @notice Burn `_amount` of the burnable token and receive the pro-rata
     *         share of every token in `redeemableTokens`.
     */
    function redeem(uint256 _amount) external nonReentrant returns (uint256[] memory payouts) {
        require(finalized, "!finalized");
        require(_amount > 0, "!amount");
        _onBeforeRedeem(_amount);

        _burnable().safeTransferFrom(msg.sender, BURN_ADDRESS, _amount);

        uint256 denom = _denominator();
        uint256 len = redeemableTokens.length;
        payouts = new uint256[](len);
        for (uint256 i = 0; i < len; i++) {
            address t = redeemableTokens[i];
            uint256 payout = (_amount * redeemableTokenAllocation[t]) / denom;
            payouts[i] = payout;
            if (payout > 0) {
                IERC20(t).safeTransfer(msg.sender, payout);
            }
        }

        _onAfterRedeem(msg.sender, _amount);
        emit Redeemed(msg.sender, _amount, payouts);
    }

    /**
     * @notice Send the full balance of `_token` to `_to`. When permitted is
     *         determined by the subclass via `_requireCanSweep`.
     */
    function sweep(address _token, address _to) external onlyOwner {
        _requireCanSweep();
        require(_to != address(0), "!to");
        uint256 bal = IERC20(_token).balanceOf(address(this));
        if (bal > 0) {
            IERC20(_token).safeTransfer(_to, bal);
        }
        emit Swept(_token, _to, bal);
    }

    function setOwner(address _owner) external onlyOwner {
        require(_owner != address(0), "!owner");
        owner = _owner;
        emit OwnerSet(_owner);
    }

    // ─────────────────────── Virtual hooks ───────────────────────

    function _burnable() internal view virtual returns (IERC20);

    function _denominator() internal view virtual returns (uint256);

    function _requireCanSweep() internal view virtual;

    function _onBeforeFinalize() internal virtual {}

    function _onAfterFinalize() internal virtual {}

    function _onBeforeRedeem(uint256) internal virtual {}

    function _onAfterRedeem(address, uint256) internal virtual {}
}
