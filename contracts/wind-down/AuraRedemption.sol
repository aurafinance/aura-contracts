// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { ERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts-0.8/security/ReentrancyGuard.sol";

/**
 * @title   AuraRedemption (Contract A)
 * @notice  Stage 0 wind-down entry. AURA holders burn AURA in exchange for a
 *          1:1 rAURA receipt and a pro-rata share of a treasury basket.
 *          Pro-rata denominator is the immutable `REDEEMABLE_AURA_SUPPLY`
 *          (total AURA supply minus protocol-owned / ineligible AURA).
 */
contract AuraRedemption is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address private constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    IERC20 public immutable aura;
    uint256 public immutable REDEEMABLE_AURA_SUPPLY;
    uint256 public immutable expiry;

    address[] public redeemableTokens;
    mapping(address => uint256) public redeemableTokenAllocation;

    bool public finalized;
    address public owner;

    event Finalized(address[] tokens, uint256[] allocations);
    event Redeemed(address indexed user, uint256 auraBurned, uint256[] payouts);
    event Swept(address indexed token, address indexed to, uint256 amount);
    event OwnerSet(address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "!owner");
        _;
    }

    constructor(
        string memory _name,
        string memory _symbol,
        address _aura,
        uint256 _redeemableAuraSupply,
        uint256 _expiry,
        address _owner
    ) ERC20(_name, _symbol) {
        require(_aura != address(0), "!aura");
        require(_redeemableAuraSupply > 0, "!supply");
        require(_expiry > block.timestamp, "!expiry");
        require(_owner != address(0), "!owner");

        aura = IERC20(_aura);
        REDEEMABLE_AURA_SUPPLY = _redeemableAuraSupply;
        expiry = _expiry;
        owner = _owner;
    }

    function redeemableTokensLength() external view returns (uint256) {
        return redeemableTokens.length;
    }

    /**
     * @notice Snapshots the current balance of each token as its allocation.
     *         Must be called while the contract is fully funded. One-shot.
     */
    function finalize(address[] calldata _tokens) external onlyOwner {
        require(!finalized, "finalized");
        require(block.timestamp < expiry, "expired");
        require(_tokens.length > 0, "!tokens");

        uint256[] memory allocs = new uint256[](_tokens.length);
        for (uint256 i = 0; i < _tokens.length; i++) {
            address t = _tokens[i];
            require(t != address(0) && t != address(aura), "!token");
            require(redeemableTokenAllocation[t] == 0, "dup");
            uint256 bal = IERC20(t).balanceOf(address(this));
            require(bal > 0, "!funded");
            redeemableTokenAllocation[t] = bal;
            allocs[i] = bal;
            redeemableTokens.push(t);
        }

        finalized = true;
        emit Finalized(_tokens, allocs);
    }

    /**
     * @notice Burn `_amount` AURA, mint `_amount` rAURA, and receive the
     *         pro-rata share of every token in `redeemableTokens`.
     */
    function redeem(uint256 _amount) external nonReentrant returns (uint256[] memory payouts) {
        require(finalized, "!finalized");
        require(block.timestamp < expiry, "expired");
        require(_amount > 0, "!amount");

        aura.safeTransferFrom(msg.sender, BURN_ADDRESS, _amount);

        uint256 len = redeemableTokens.length;
        payouts = new uint256[](len);
        for (uint256 i = 0; i < len; i++) {
            address t = redeemableTokens[i];
            uint256 payout = (_amount * redeemableTokenAllocation[t]) / REDEEMABLE_AURA_SUPPLY;
            payouts[i] = payout;
            if (payout > 0) {
                IERC20(t).safeTransfer(msg.sender, payout);
            }
        }

        _mint(msg.sender, _amount);

        emit Redeemed(msg.sender, _amount, payouts);
    }

    /**
     * @notice Sweep the full balance of `_token` to `_to` after `expiry`.
     *         Intended to flow residual treasury into the rAURA contract.
     */
    function sweep(address _token, address _to) external onlyOwner {
        require(block.timestamp >= expiry, "!expired");
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
