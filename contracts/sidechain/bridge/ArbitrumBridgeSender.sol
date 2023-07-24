// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { Ownable } from "@openzeppelin/contracts-0.8/access/Ownable.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { BridgeDelegateSender } from "./BridgeDelegateSender.sol";

interface IArbitrumGatewayRouter {
    function outboundTransfer(
        address _l1Token,
        address _to,
        uint256 _amount,
        bytes calldata _data
    ) external payable returns (bytes memory);
}

contract ArbitrumBridgeSender is BridgeDelegateSender {
    using SafeERC20 for IERC20;

    /* -------------------------------------------------------------------
       Storage 
    ------------------------------------------------------------------- */

    /// @dev The Arbitrum bridge address
    address public immutable gatewayRouter;

    /// @dev Mainnet CRV token address
    address public immutable l1Crv;

    /* -------------------------------------------------------------------
       Constructor 
    ------------------------------------------------------------------- */

    /**
     * @dev Constructs the ArbitrumBridgeSender contract.
     * @param _gatewayRouter The arbitrum gatewayRouter address.
     * @param _crv The L2 token address.
     * @param _l1Crv The L1 token address.
     */
    constructor(
        address _gatewayRouter,
        address _crv,
        address _l1Crv
    ) {
        gatewayRouter = _gatewayRouter;
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
    function send(uint256 _amount) external override onlyKeeper {
        require(l1Receiver != address(0), "L1ReceiverNotSet");
        IERC20(crv).safeApprove(gatewayRouter, 0);
        IERC20(crv).safeApprove(gatewayRouter, _amount);
        IArbitrumGatewayRouter(gatewayRouter).outboundTransfer(l1Crv, l1Receiver, _amount, bytes(""));
        emit Send(l1Receiver, _amount);
    }
}
