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

    /// @dev The bridge delegate contract
    address public bridgeDelegate;

    /// @dev Accumulated BAL rewards
    uint256 public accBalRewards;

    /// @dev Accumulated AURA rewards
    uint256 public accAuraRewards;

    /* -------------------------------------------------------------------
       Events 
    ------------------------------------------------------------------- */
    /**
     * @dev Emitted when the bridge delegate address is updated.
     * @param bridgeDelegate    The new bridge delegate address.
     */
    event BridgeDelegateUpdated(address bridgeDelegate);

    /* -------------------------------------------------------------------
       Constructor 
    ------------------------------------------------------------------- */

    constructor(address _auraOFT, uint16 _canonicalChainId) {
        auraOFT = _auraOFT;
        canonicalChainId = _canonicalChainId;
    }

    /* -------------------------------------------------------------------
       View Functions
    ------------------------------------------------------------------- */

    /**
     * @notice Get mint rate based on accumulated BAL and AURA
     * @dev Dev mint rate is aura per bal rewards
     */
    function mintRate() public view returns (uint256) {
        if (accBalRewards <= 0) return 0;
        return accAuraRewards.mul(1e18).div(accBalRewards);
    }

    /* -------------------------------------------------------------------
       Setter Functions
    ------------------------------------------------------------------- */

    /**
     * @notice Initializes the booster and balToken addresses
     * @dev This function should only be called by the owner of the contract
     * @param _booster Address of the booster
     * @param _balToken Address of the balToken
     * @param _lzEndpoint   LayerZero endpoint contract
     */
    function initialize(
        address _booster,
        address _balToken,
        address _lzEndpoint
    ) external onlyOwner {
        require(booster == address(0), "already initialized");
        booster = _booster;
        balToken = _balToken;
        _initializeLzApp(_lzEndpoint);
    }

    function setBridgeDelegate(address _bridgeDelegate) external onlyOwner {
        bridgeDelegate = _bridgeDelegate;
        emit BridgeDelegateUpdated(bridgeDelegate);
    }

    /**
     * @dev Sets the configuration for a given source chain ID and selector.
     * @param _srcChainId The source chain ID.
     * @param _selector The selector.
     * @param _adapterParams The adapter params.
     */
    function setAdapterParams(
        uint16 _srcChainId,
        bytes32 _selector,
        bytes memory _adapterParams
    ) external override onlyOwner {
        _setAdapterParams(_srcChainId, _selector, _adapterParams);
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
        uint256 _mintRate = mintRate();
        require(_mintRate > 0, "!mintRate");

        uint256 amount = (_amount * _mintRate) / 1e18;

        accBalRewards = accBalRewards.sub(_amount);
        accAuraRewards = accAuraRewards.sub(amount);

        IERC20(auraOFT).safeTransfer(_to, amount);
    }

    /**
     * @dev Called by the booster.earmarkRewards to register feeDebt with the L1
     *      and receive CVX tokens in return
     * @param _originalSender Sender that initiated the Booster call
     * @param _fees Amount of CRV that was received as fees
     * @param _rewards Amount of CRV that was received by the reward contract
     * @param _zroPaymentAddress The LayerZero ZRO payment address
     */
    function queueNewRewards(
        address _originalSender,
        uint256 _fees,
        uint256 _rewards,
        address _zroPaymentAddress
    ) external payable {
        require(msg.sender == booster, "!booster");
        require(bridgeDelegate != address(0), "!bridgeDelegate");

        // Update accumulated BAL rewards with the latest rewards
        accBalRewards = accBalRewards.add(_rewards);

        // Transfer reward token balance to bridge delegate
        uint256 balance = IERC20(balToken).balanceOf(address(this));
        IERC20(balToken).safeTransfer(bridgeDelegate, balance);

        // Notify L1 chain of collected fees
        bytes memory payload = CCM.encodeFees(_fees);
        bytes memory adapterParams = getAdapterParams[canonicalChainId][keccak256("queueNewRewards(address,uint256)")];

        _lzSend(
            canonicalChainId, ////////// Parent chain ID
            payload, /////////////////// Payload
            payable(_originalSender), // Refund address
            _zroPaymentAddress, // ZRO payment address
            adapterParams, ////// Adapter params
            msg.value ////////////////// Native fee
        );
    }

    /* -------------------------------------------------------------------
      Layer Zero functions L1 -> L2
    ------------------------------------------------------------------- */

    /**
     * @dev Override the default lzReceive function logic
     *  Called by  L1Coordinator.distributeAura
     */
    function _nonblockingLzReceive(
        uint16, /** _srcChainId */
        bytes memory,
        uint64,
        bytes memory _payload
    ) internal virtual override {
        if (CCM.isCustomMessage(_payload)) {
            CCM.MessageType messageType = CCM.getMessageType(_payload);
            if (messageType == CCM.MessageType.FEES_CALLBACK) {
                uint256 cvxAmount = CCM.decodeFeesCallback(_payload);

                // Update accumulated rewards with the latest AURA distribution
                accAuraRewards = accAuraRewards.add(cvxAmount);
            }
        }
    }
}
