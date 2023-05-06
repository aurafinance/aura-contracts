// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { IBooster } from "../interfaces/IBooster.sol";
import { CrossChainConfig } from "./CrossChainConfig.sol";
import { CrossChainMessages as CCM } from "./CrossChainMessages.sol";
import { NonblockingLzApp } from "../layerzero/lzApp/NonblockingLzApp.sol";
import { IOFT } from "../layerzero/token/oft/IOFT.sol";
import { AuraMath } from "../utils/AuraMath.sol";

/**
 * @title   L1Coordinator
 * @author  AuraFinance
 * @dev Tracks the amount of fee debt accrued by each sidechain and
 *      sends AURA back to each sidechain for rewards
 */
contract L1Coordinator is NonblockingLzApp, CrossChainConfig {
    using AuraMath for uint256;
    using SafeERC20 for IERC20;

    /* -------------------------------------------------------------------
       Storage 
    ------------------------------------------------------------------- */

    /// @dev Booster contract address
    address public immutable booster;

    /// @dev BAL token contract
    address public immutable balToken;

    /// @dev AURA token contract
    address public immutable auraToken;

    /// @dev AURA OFT token contract
    address public immutable auraOFT;

    /// @dev src chain ID mapped to total feeDebt
    mapping(uint16 => uint256) public feeDebtOf;

    /// @dev src chain ID mapped to total settled feeDebt
    mapping(uint16 => uint256) public settledFeeDebtOf;

    /// @dev src chain ID mapped to total distributed feeDebt
    mapping(uint16 => uint256) public distributedFeeDebtOf;

    /// @dev src chain ID to bridgeDelegate
    mapping(uint16 => address) public bridgeDelegates;

    /// @dev src chain ID to L2Coordinator address
    mapping(uint16 => address) public l2Coordinators;

    /// @dev sender to isDistributor
    mapping(address => bool) public distributors;

    /* -------------------------------------------------------------------
       Events 
    ------------------------------------------------------------------- */

    event BridgeDelegateUpdated(uint16 srcChainId, address bridgeDelegate);
    event L2CoordinatorUpated(uint16 srcChainId, address l2Coordinator);
    event DisributorUpdated(address distributor, bool active);
    event FeeDebtNotified(uint16 srcChainId, uint256 amount);
    event AuraDistributed(uint16 srcChainId, uint256 amount);
    event FeeDebtSettled(uint16 srcChainId, uint256 amount);

    /* -------------------------------------------------------------------
       Modifiers  
    ------------------------------------------------------------------- */

    modifier onlyDistributor() {
        require(distributors[msg.sender], "!distributor");
        _;
    }

    /* -------------------------------------------------------------------
       Constructor 
    ------------------------------------------------------------------- */

    constructor(
        address _lzEndpoint,
        address _booster,
        address _balToken,
        address _auraToken,
        address _auraOFT
    ) NonblockingLzApp(_lzEndpoint) {
        booster = _booster;
        balToken = _balToken;
        auraToken = _auraToken;
        auraOFT = _auraOFT;

        IERC20(_balToken).safeApprove(_booster, type(uint256).max);
        IERC20(_auraToken).safeApprove(_auraOFT, type(uint256).max);
    }

    /* -------------------------------------------------------------------
       Setter Functions
    ------------------------------------------------------------------- */

    function setConfig(
        uint16 _srcChainId,
        bytes4 _selector,
        Config memory _config
    ) external override onlyOwner {
        _setConfig(_srcChainId, _selector, _config);
    }

    /**
     * @dev Set bridge delegate for given srcChainId
     * @param _srcChainId        ID of the source chain
     * @param bridgeDelegate     Address of the bridge delegate
     */
    function setBridgeDelegate(uint16 _srcChainId, address bridgeDelegate) external onlyOwner {
        bridgeDelegates[_srcChainId] = bridgeDelegate;
        emit BridgeDelegateUpdated(_srcChainId, bridgeDelegate);
    }

    function setL2Coordinator(uint16 _srcChainId, address l2Coordinator) external onlyOwner {
        l2Coordinators[_srcChainId] = l2Coordinator;
        emit L2CoordinatorUpated(_srcChainId, l2Coordinator);
    }

    function setDistributor(address _distributor, bool _active) external onlyOwner {
        distributors[_distributor] = _active;
        emit DisributorUpdated(_distributor, _active);
    }

    /* -------------------------------------------------------------------
       Core Functions
    ------------------------------------------------------------------- */

    /**
     * @dev Called by a src chain when fees have be collected and are on their
     *      way back to the canonical chain via the bridge delegate
     */
    function _notifyFees(uint16 _srcChainId, uint256 _amount) internal {
        feeDebtOf[_srcChainId] += _amount;
        emit FeeDebtNotified(_srcChainId, _amount);
    }

    function distributeAura(uint16 _srcChainId, bytes memory _sendFromAdapterParams) external payable onlyDistributor {
        uint256 distributedFeeDebt = distributedFeeDebtOf[_srcChainId];
        uint256 feeDebt = feeDebtOf[_srcChainId].sub(distributedFeeDebt);
        distributedFeeDebtOf[_srcChainId] = distributedFeeDebt.add(feeDebt);

        _distributeAura(
            _srcChainId,
            feeDebt,
            configs[_srcChainId][L1Coordinator.distributeAura.selector].zroPaymentAddress,
            configs[_srcChainId][L1Coordinator.distributeAura.selector].adapterParams,
            _sendFromAdapterParams
        );
        emit AuraDistributed(_srcChainId, feeDebt);
    }

    /**
     * @dev Distribute AURA to the src chain using the BAL float in this
     *      contract mint AURA by calling distributeL2Fees on the Booster
     *      and then send those AURA tokens to the src chain
     */
    function _distributeAura(
        uint16 _srcChainId,
        uint256 _feeAmount,
        address _zroPaymentAddress,
        bytes memory _adapterParams,
        bytes memory _sendFromAdapterParams
    ) internal {
        uint256 auraBefore = IERC20(auraToken).balanceOf(address(this));
        IBooster(booster).distributeL2Fees(_feeAmount);
        uint256 auraAmount = IERC20(auraToken).balanceOf(address(this)).sub(auraBefore);

        address to = l2Coordinators[_srcChainId];
        require(to != address(0), "to can not be zero");

        bytes memory payload = CCM.encodeFeesCallback(auraAmount, _feeAmount);

        _lzSend(
            _srcChainId, ///////////// Source chain (L2 chain)
            payload, ///////////////// Payload
            payable(address(this)), // Refund address
            address(0), ////////////// ZRO payment address
            _adapterParams, ////////// Adapter params
            msg.value //////////////// Native fee
        );

        IOFT(auraOFT).sendFrom{ value: address(this).balance }(
            address(this),
            _srcChainId,
            abi.encodePacked(to),
            auraAmount,
            payable(msg.sender),
            _zroPaymentAddress,
            _sendFromAdapterParams
        );
    }

    /**
     * @dev Receive CRV from the L2 via some thirdpart bridge
     *      to settle the feeDebt for the remote chain
     */
    function settleFeeDebt(uint16 _srcChainId, uint256 _amount) external {
        address bridgeDelegate = bridgeDelegates[_srcChainId];
        require(bridgeDelegate == msg.sender, "!bridgeDelegate");

        uint256 settledFeeDebt = settledFeeDebtOf[_srcChainId];
        uint256 feeOwed = feeDebtOf[_srcChainId].sub(settledFeeDebt);
        require(_amount <= feeOwed, "!amount");
        settledFeeDebtOf[_srcChainId] = settledFeeDebt.add(_amount);

        IERC20(balToken).safeTransferFrom(bridgeDelegate, address(this), _amount);
        emit FeeDebtSettled(_srcChainId, _amount);
    }

    /* -------------------------------------------------------------------
      Layer Zero functions L1 -> L2
    ------------------------------------------------------------------- */

    /**
     * @dev Override the default OFT lzReceive function logic
     * Called by the L2Coordinator.queueNewRewards to register feeDebt
     */
    function _nonblockingLzReceive(
        uint16 _srcChainId,
        bytes memory _srcAddress,
        uint64 _nonce,
        bytes memory _payload
    ) internal virtual override {
        if (CCM.isCustomMessage(_payload)) {
            // The payload is a specific cross chain message we decode
            // the type to determine what the message is an continue
            CCM.MessageType messageType = CCM.getMessageType(_payload);
            if (messageType == CCM.MessageType.FEES) {
                // Receiving a fees update message from the L2. We decode
                // The payload to get the amount of fees being sent
                uint256 feeAmount = CCM.decodeFees(_payload);
                _notifyFees(_srcChainId, feeAmount);
            }
        }
    }

    receive() external payable {}
}
