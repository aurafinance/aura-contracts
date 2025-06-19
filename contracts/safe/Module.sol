// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;
import { ISafe } from "./ISafe.sol";

/**
 * @author  Aura Finance
 * @notice  Generic module contract to be inherited by all modules
 */
contract Module {
    /// @notice The address of the Safe contract
    address public immutable safeWallet;

    /**
     * @notice Constructor for the Module
     * @param _safeWallet Address of the Safe
     */
    constructor(address _safeWallet) {
        safeWallet = _safeWallet;
    }

    /**
     * @notice  Execute a call via the Safe contract
     * @param to    Destination address to call
     * @param data  Data payload of the transaction
     * @return success bool for success
     */
    function _execCallFromModule(address to, bytes memory data) internal virtual returns (bool success) {
        ISafe safe = ISafe(payable(safeWallet));

        success = safe.execTransactionFromModule({ to: to, value: 0, data: data, operation: ISafe.Operation.Call });
        require(success, "!success");
        return success;
    }
}
