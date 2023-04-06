// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { IBooster } from "../interfaces/IBooster.sol";
import { IAuraLocker } from "../interfaces/IAuraLocker.sol";
import { AuraMath } from "../utils/AuraMath.sol";
import { CrossChainConfig } from "./CrossChainConfig.sol";
import { CrossChainMessages as CCM } from "./CrossChainMessages.sol";
import { ProxyOFT } from "../layerzero/token/oft/extension/ProxyOFT.sol";

/**
 * @title AuraOFT
 * @dev Sends AURA to all the Sidechains and tracks the amount of fee debt
 */
contract AuraOFT is ProxyOFT, CrossChainConfig {
    using AuraMath for uint256;

    /* -------------------------------------------------------------------
       Storage 
    ------------------------------------------------------------------- */

    /// @dev Booster contract address
    address public booster;

    /// @dev Aura Locker contract address
    address public locker;

    /// @dev BAL token contract
    address public crv;

    /// @dev src chain ID mapped to feeDebt
    mapping(uint16 => uint256) public feeDebt;

    /* -------------------------------------------------------------------
       Constructor 
    ------------------------------------------------------------------- */

    constructor(
        address _lzEndpoint,
        address _token,
        address _booster,
        address _locker,
        address _crv
    ) ProxyOFT(_lzEndpoint, _token) {
        booster = _booster;
        locker = _locker;
        crv = _crv;

        IERC20(_crv).approve(_booster, type(uint256).max);
        IERC20(_token).approve(_locker, type(uint256).max);
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
            configs[_srcChainId][AuraOFT.distributeAura.selector].adapterParams
        );
    }

    function _distributeAura(
        uint16 _srcChainId,
        uint256 _feeAmount,
        bytes memory _adapterParams
    ) internal {
        uint256 cvxBefore = IERC20(token()).balanceOf(address(this));
        IBooster(booster).distributeL2Fees(_feeAmount);
        uint256 cvxAmount = IERC20(token()).balanceOf(address(this)).sub(cvxBefore);

        uint256 fullAmount = _feeToFullAmount(_feeAmount);
        bytes memory payload = CCM.encodeFeesCallback(cvxAmount, fullAmount);

        _lzSend(
            _srcChainId, ////////// Source chain (L2 chain to send AURA to)
            payload, ////////////// Payload
            payable(msg.sender), // Refund address
            address(0), /////////// ZRO payment address
            _adapterParams, /////// Adapter params
            msg.value ///////////// Native fee
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
     * @dev Lock tokens in the Locker contract
     * @param _sender Address that is locking
     * @param _amount Amount to lock
     */
    function _lockFor(address _sender, uint256 _amount) internal {
        IAuraLocker(locker).lock(_sender, _amount);
    }

    /**
     * @dev Receive CRV from the L2 via some thirdpart bridge
     *      to settle the feeDebt for the remote chain
     */
    function settleFeeDebt(uint256 _srcChainId, uint256 _amount) external {}

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
            } else if (messageType == CCM.MessageType.LOCK) {
                // Receiving a lock request from the L2. We decode
                // The payload to get the sender and the amount to lock
                (address sender, uint256 amount) = CCM.decodeLock(_payload);
                _lockFor(sender, amount);
            }
        } else {
            // The message is not a specific cross chain message so we just
            // fallback to the normal LZ OFT flow
            super._nonblockingLzReceive(_srcChainId, _srcAddress, _nonce, _payload);
        }
    }
}
