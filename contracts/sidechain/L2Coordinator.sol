// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { NonblockingLzApp } from "../layerzero/lzApp/NonblockingLzApp.sol";
import { CrossChainConfig } from "./CrossChainConfig.sol";
import { CrossChainMessages as CCM } from "./CrossChainMessages.sol";
import { AuraMath } from "../utils/AuraMath.sol";
import { IBooster } from "../interfaces/IBooster.sol";

/**
 * @title   L2Coordinator
 * @author  AuraFinance
 * @dev     Coordinates LZ messages and actions from the L1 on the L2
 */
contract L2Coordinator is NonblockingLzApp, CrossChainConfig {
    using AuraMath for uint256;
    using SafeERC20 for IERC20;

    /* -------------------------------------------------------------------
       Storage 
    ------------------------------------------------------------------- */

    /// @dev canonical chain ID
    uint16 public immutable canonicalChainId;

    /// @dev AuraOFT contract
    address public immutable auraOFT;

    /// @dev Booster contract
    address public booster;

    /// @dev The BAL token contract
    address public balToken;

    /// @dev Rate to send CVX on mint
    uint256 public mintRate;

    /// @dev The bridge delegate contract
    address public bridgeDelegate;

    /* -------------------------------------------------------------------
       Constructor 
    ------------------------------------------------------------------- */

    constructor(
        address _lzEndpoint,
        address _auraOFT,
        uint16 _canonicalChainId
    ) NonblockingLzApp(_lzEndpoint) {
        auraOFT = _auraOFT;
        canonicalChainId = _canonicalChainId;
    }

    /* -------------------------------------------------------------------
       Setter Functions
    ------------------------------------------------------------------- */

    function initialize(address _booster, address _balToken) external onlyOwner {
        require(booster == address(0), "already initialized");
        booster = _booster;
        balToken = _balToken;
    }

    function setBridgeDelegate(address _bridgeDelegate) external onlyOwner {
        bridgeDelegate = _bridgeDelegate;
    }

    function setConfig(
        uint16 _srcChainId,
        bytes4 _selector,
        Config memory _config
    ) external override onlyOwner {
        _setConfig(_srcChainId, _selector, _config);
    }

    /* -------------------------------------------------------------------
       Core Functions
    ------------------------------------------------------------------- */

    /**
     * @dev Mint function called by Booster.rewardClaimed. uses the CVX (L2)
     *      balance of this contract to transfer tokens
     * @param _to     Address to send CVX (L2) to
     * @param _amount Amount of CRV rewardClaimed was called with
     */
    function mint(address _to, uint256 _amount) external {
        require(msg.sender == booster, "!booster");
        uint256 amount = (_amount * mintRate) / 1e18;
        IERC20(auraOFT).safeTransfer(_to, amount);
    }

    /**
     * @dev Called by the booster.earmarkRewards to register feeDebt with the L1
     *      and receive CVX tokens in return
     * @param _originalSender Sender that initiated the Booster call
     * @param _rewards Amount of CRV that was received as rewards
     */
    function queueNewRewards(address _originalSender, uint256 _rewards) external payable {
        require(msg.sender == booster, "!booster");
        require(bridgeDelegate != address(0), "!bridgeDelegate");

        // Transfer reward token balance to bridge delegate
        uint256 balance = IERC20(balToken).balanceOf(address(this));
        IERC20(balToken).safeTransfer(bridgeDelegate, balance);

        // Notify L1 chain of collected fees
        bytes memory payload = CCM.encodeFees(_rewards);
        CrossChainConfig.Config memory config = configs[canonicalChainId][L2Coordinator.queueNewRewards.selector];

        _lzSend(
            canonicalChainId, ////////// Parent chain ID
            payload, /////////////////// Payload
            payable(_originalSender), // Refund address
            config.zroPaymentAddress, // ZRO payment address
            config.adapterParams, ////// Adapter params
            msg.value ////////////////// Native fee
        );
    }

    /* -------------------------------------------------------------------
      Layer Zero functions L1 -> L2
    ------------------------------------------------------------------- */

    /**
     * @dev Override the default lzReceive function logic
     */
    function _nonblockingLzReceive(
        uint16 _srcChainId,
        bytes memory,
        uint64,
        bytes memory _payload
    ) internal virtual override {
        if (CCM.isCustomMessage(_payload)) {
            CCM.MessageType messageType = CCM.getMessageType(_payload);
            if (messageType == CCM.MessageType.FEES_CALLBACK) {
                (uint256 cvxAmount, uint256 crvFeeAmount) = CCM.decodeFeesCallback(_payload);

                // The mint rate is the amount of CVX we mint for 1 CRV received
                // It is sent over each time the fee debt is updated on the L1 to try and keep
                // the L2 rate as close as possible to the L1 rate
                mintRate = cvxAmount.mul(1e18).div(_feeToRewardAmount(crvFeeAmount));
            }
        }
    }

    /**
     * @dev Given an amount of fees tha was paid get the amount of rewards
     *      that would have been sent to the reward contract
     *
     *      total BAL farmed = fees * denominator / incetive %
     *      total rewards = total BAL farmed - fees
     *
     * @param _feeAmount The amount of fees
     */
    function _feeToRewardAmount(uint256 _feeAmount) internal view returns (uint256) {
        uint256 totalIncentives = IBooster(booster).lockIncentive() +
            IBooster(booster).stakerIncentive() +
            IBooster(booster).platformFee();
        uint256 total = _feeAmount.mul(IBooster(booster).FEE_DENOMINATOR()).div(totalIncentives);
        return total.sub(_feeAmount);
    }
}
