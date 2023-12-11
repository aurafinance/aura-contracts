// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { Multicall3 } from "./Multicall3.sol";

/**
 *  @title PayableMulticall
 *  @notice Aggregate results from multiple function calls
 *  @author Aura Finance
 */
contract PayableMulticall is Multicall3 {
    using SafeERC20 for IERC20;

    function recoverEthBalance(address _to) external {
        uint256 bal = address(this).balance;
        if (bal > 0) {
            (bool sent, ) = payable(_to).call{ value: bal }("");
            require(sent, "!refund");
        }
    }

    function recoverERC20(address _tokenAddress, address _to) external {
        uint256 bal = IERC20(_tokenAddress).balanceOf(address(this));
        if (bal > 0) {
            IERC20(_tokenAddress).safeTransfer(_to, bal);
        }
    }
}
