// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { Ownable } from "@openzeppelin/contracts-0.8/access/Ownable.sol";

interface IBridgeDelegateReceiver {
    function settleFeeDebt(uint256 _amount) external;
}

/**
 * @title   BridgeDelegateReceiverHelper
 * @author  AuraFinance
 * @notice  Forwards fees from multiple receivers and settles debts
 */
contract BridgeDelegateReceiverHelper is Ownable {
    /**
     * @notice Forwards ownership of a receiver from this contract to another address
     * @param _receiver bridge delegate receiver
     * @param _newOwner the new owner of the reciever
     */
    function transferReceiverOwnership(address _receiver, address _newOwner) external onlyOwner {
        Ownable(_receiver).transferOwnership(_newOwner);
    }

    /**
     * @notice settles debt for a single reciever
     * @param _receiver bridge delegate receiver
     * @param _amount amount of debt to settle
     */
    function settleFeeDebt(address _receiver, uint256 _amount) public onlyOwner {
        IBridgeDelegateReceiver(_receiver).settleFeeDebt(_amount);
    }

    /**
     * @notice settles debt for multiple receivers
     * @param _receivers bridge delegate receiver list
     * @param _amounts amount of debt to settle for each receiver
     */
    function settleMultipleFeeDebt(address[] calldata _receivers, uint256[] calldata _amounts) external onlyOwner {
        require(_receivers.length == _amounts.length, "!parity");
        for (uint256 i = 0; i < _receivers.length; i++) {
            settleFeeDebt(_receivers[i], _amounts[i]);
        }
    }
}
