// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { Ownable } from "@openzeppelin/contracts-0.8/access/Ownable.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { BridgeDelegateSender } from "./BridgeDelegateSender.sol";

interface IL2StandardBridge {
    function withdrawTo(
        address _l2Token,
        address _to,
        uint256 _amount,
        uint32 _l1Gas,
        bytes calldata _data
    ) external;
}

contract OptimismBridgeSender is BridgeDelegateSender {
    using SafeERC20 for IERC20;

    /* -------------------------------------------------------------------
       Storage 
    ------------------------------------------------------------------- */

    /// @dev The Gnosis bridge address
    address public immutable l2StandardBridge;

    /// @dev Mainnet CRV token address
    address public immutable l1Crv;

    /* -------------------------------------------------------------------
       Constructor 
    ------------------------------------------------------------------- */

    /**
     * @dev Constructs the GnosisBridgeSender contract.
     * @param _l2StandardBridge The optimism l2 standard bridge address.
     * @param _crv The L2 token address.
     * @param _l1Crv The L1 token address.
     */
    constructor(
        address _l2StandardBridge,
        address _crv,
        address _l1Crv
    ) {
        l2StandardBridge = _l2StandardBridge;
        crv = _crv;
        l1Crv = _l1Crv;
    }

    /* -------------------------------------------------------------------
       Functions
    ------------------------------------------------------------------- */

    /**
     * @dev Function to send a specified amount of tokens.
     * Requirements:
     * - The caller must be the owner of the contract.
     * @param _amount The amount of CRV tokens to be sent
     */
    function send(uint256 _amount) external override onlyOwner {
        require(l1Receiver != address(0), "L1ReceiverNotSet");
        IERC20(crv).safeApprove(l2StandardBridge, _amount);
        IL2StandardBridge(l2StandardBridge).withdrawTo(crv, l1Receiver, _amount, 0, bytes(""));
        emit Send(l1Receiver, _amount);
    }
}
