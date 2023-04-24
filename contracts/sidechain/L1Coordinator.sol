// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
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

    /* -------------------------------------------------------------------
       Storage 
    ------------------------------------------------------------------- */

    /// @dev Booster contract address
    address public booster;

    /// @dev BAL token contract
    address public balToken;

    /// @dev AURA token contract
    address public auraToken;

    /// @dev AURA OFT token contract
    address public auraOFT;

    /// @dev src chain ID mapped to feeDebt
    mapping(uint16 => uint256) public feeDebt;

    /// @dev src chain ID to bridgeDelegate
    mapping(uint16 => address) public bridgeDelegates;

    /// @dev src chain ID to L2Coordinator address
    mapping(uint16 => address) public l2Coordinators;

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

        IERC20(_balToken).approve(_booster, type(uint256).max);
        IERC20(_auraToken).approve(_auraOFT, type(uint256).max);
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
    }

    function setL2Coordinator(uint16 _srcChainId, address l2Coordinator) external onlyOwner {
        l2Coordinators[_srcChainId] = l2Coordinator;
    }

    /* -------------------------------------------------------------------
       Core Functions
    ------------------------------------------------------------------- */

    /**
     * @dev  Receive an LZ message from the L2 to trigger an
     *       AURA mint using the fee float held by this contract
     *       via the Booster.distributeL2Fees function. Then update
     *       the AURA rate for (TODO: this chain or globally? TBD)
     */
    function _notifyFees(uint16 _srcChainId, uint256 _amount) internal {
        feeDebt[_srcChainId] += _amount;
    }

    function distributeAura(uint16 _srcChainId) external payable {
        _distributeAura(
            _srcChainId,
            feeDebt[_srcChainId],
            configs[_srcChainId][L1Coordinator.distributeAura.selector].zroPaymentAddress,
            configs[_srcChainId][L1Coordinator.distributeAura.selector].adapterParams
        );
    }

    function _distributeAura(
        uint16 _srcChainId,
        uint256 _feeAmount,
        address _zroPaymentAddress,
        bytes memory _adapterParams
    ) internal {
        uint256 cvxBefore = IERC20(auraToken).balanceOf(address(this));
        IBooster(booster).distributeL2Fees(_feeAmount);
        uint256 cvxAmount = IERC20(auraToken).balanceOf(address(this)).sub(cvxBefore);

        uint256 fullAmount = _feeToFullAmount(_feeAmount);
        address to = l2Coordinators[_srcChainId];
        require(to != address(0), "to can not be zero");

        // TODO: do something better here
        uint256 nativeFee = msg.value / 2;
        bytes memory payload = CCM.encodeFeesCallback(cvxAmount, fullAmount);

        _lzSend(
            _srcChainId, ////////// Source chain (L2 chain)
            payload, ////////////// Payload
            payable(msg.sender), // Refund address
            address(0), /////////// ZRO payment address
            _adapterParams, /////// Adapter params
            nativeFee ///////////// Native fee
        );

        IOFT(auraOFT).sendFrom{ value: nativeFee }(
            address(this),
            _srcChainId,
            abi.encodePacked(to),
            fullAmount,
            payable(msg.sender),
            _zroPaymentAddress,
            _adapterParams
        );
    }

    function _feeToFullAmount(uint256 _feeAmount) internal view returns (uint256) {
        uint256 totalIncentives = IBooster(booster).lockIncentive() +
            IBooster(booster).stakerIncentive() +
            IBooster(booster).earmarkIncentive() +
            IBooster(booster).platformFee();
        return ((_feeAmount * IBooster(booster).FEE_DENOMINATOR()) / totalIncentives);
    }

    /**
     * @dev Receive CRV from the L2 via some thirdpart bridge
     *      to settle the feeDebt for the remote chain
     */
    function settleFeeDebt(uint16 _srcChainId, uint256 _amount) external {
        address bridgeDelegate = bridgeDelegates[_srcChainId];
        require(bridgeDelegate == msg.sender, "!bridgeDelegate");

        feeDebt[_srcChainId] -= _amount;

        IERC20(balToken).transferFrom(bridgeDelegate, address(this), _amount);
    }

    /* -------------------------------------------------------------------
      Layer Zero functions L1 -> L2
    ------------------------------------------------------------------- */

    /**
     * @dev Override the default OFT lzReceive function logic
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
}
