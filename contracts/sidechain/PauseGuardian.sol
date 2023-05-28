// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { Pausable } from "@openzeppelin/contracts-0.8/security/Pausable.sol";

/**
 * @title PauseGuardian
 * @author AuraFinance
 * @dev Contract module which allows children to implement an emergency stop
 * mechanism that can be triggered by an authorized immutable guardian address.
 */
contract PauseGuardian is Pausable {
    /* -------------------------------------------------------------------
       Storage 
    ------------------------------------------------------------------- */

    /// @dev The guardian address
    address public guardian;

    /* -------------------------------------------------------------------
       Initialize       
    ------------------------------------------------------------------- */
    /**
     * @dev Constructs the PauseGuardian contract
     * @param _guardian   The pause guardian address
     */

    function _initializePauseGuardian(address _guardian) internal {
        require(guardian == address(0), "already initialized");
        require(_guardian != address(0), "guardian=0");
        guardian = _guardian;
    }

    /* -------------------------------------------------------------------
       Modifiers 
    ------------------------------------------------------------------- */

    modifier onlyGuardian() {
        require(msg.sender == guardian, "!guardian");
        _;
    }

    /* -------------------------------------------------------------------
       Core 
    ------------------------------------------------------------------- */

    /**
     * @notice This function pauses the contract.
     * @dev This function can only be called by the 'guardian'.
     */
    function pause() external onlyGuardian {
        _pause();
    }

    /**
     * @notice This function is used to unpause the contract.
     * @dev This function can only be called by the 'guardian' of the contract.
     */
    function unpause() external onlyGuardian {
        _unpause();
    }
}
