// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { Ownable } from "@openzeppelin/contracts-0.8/access/Ownable.sol";

interface IBridgeDelegateReceiver {
    function settleFeeDebt(uint256 _amount) external;
}

/**
 * @title   BridgeDelegateReceiverHelper
 * @author  AuraFinance
 * @notice  Forwards fees from multiple receivers
 */
contract BridgeDelegateReceiverHelper {
    using SafeERC20 for IERC20;

    function transferReceiverOwnership(address _receiver, address _newOwner) external onlyOwner {
        Ownable(_receiver).transferOwnership(_newOwner);
    }

    function settleFeeDebt(address _receiver, uint256 _amount) public onlyOwner {
        IBridgeDelegateReceiver(_receiver).settleFeeDebt(_amount);
    }

    function settleMultipleFeeDebt(address[] _receivers, uint256[] calldata _amounts) external onlyOwner {
        require(_receivers.length == _amounts.length, "!parity");
        for (uint256 i = 0; i < _receivers; i++) {
            settleFeeDebt(_receivers[i], _amounts[i]);
        }
    }
}
