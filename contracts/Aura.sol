// SPDX-License-Identifier: MIT
pragma solidity ^0.8.11;
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { ERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/ERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { Address } from "@openzeppelin/contracts-0.8/utils/Address.sol";
import { Ownable } from "@openzeppelin/contracts-0.8/access/Ownable.sol";
import { AuraMath } from "./AuraMath.sol";

interface IStaker {
    function operator() external view returns (address);
}

/**
 * @title   AuraToken
 * @author  ConvexFinance
 * @notice  Basically an ERC20 with minting functionality operated by the "operator" of the VoterProxy (Booster).
 * @dev     The minting schedule is based on the amount of CRV earned through staking and is
 *          distirbuted along a supply curve (cliffs etc). Fork of ConvexToken.
 */
contract AuraToken is ERC20, Ownable {
    using SafeERC20 for IERC20;
    using Address for address;
    using AuraMath for uint256;

    address public operator;
    address public immutable vecrvProxy;
    //1.62762546 Aura per BAL so emissions last 6 years when 30,719,598 BAL are minted
    uint256 public mintRatio = 162762546 * 1e10;
    uint256 public govMaxSupply;
    uint256 private _govTotalSupply;
    uint256 public constant EMISSIONS_MAX_SUPPLY = 100 * 1000000 * 1e18; //100m

    /* ========== EVENTS ========== */
    event OperatorChanged(address indexed previousOperator, address indexed newOperator);
    event GovMaxSupplyChanged(uint256 previousMaxSupply, uint256 newMaxSupply);
    event MintRatioChanged(uint256 previousMintRatio, uint256 newMintRatio);

    /**
     * @param _proxy        CVX VoterProxy
     * @param _nameArg      Token name
     * @param _symbolArg    Token symbol
     */
    constructor(
        address _proxy,
        string memory _nameArg,
        string memory _symbolArg
    ) ERC20(_nameArg, _symbolArg) Ownable() {
        operator = msg.sender;
        vecrvProxy = _proxy;
    }

    /**
     * @dev This can be called if the operator of the voterProxy somehow changes.
     */
    function updateOperator() public {
        _setOperator(IStaker(vecrvProxy).operator());
    }

    /**
     * @dev Sets the operator.  Only governance can do it.
     */
    function setOperator(address _operator) external onlyOwner {
        require(_operator != address(0), "invalid operator");
        _setOperator(_operator);
    }

    /**
     * @dev Sets the operator.
     */
    function _setOperator(address _operator) internal {
        emit OperatorChanged(operator, _operator);
        operator = _operator;
    }

    /**
     * @dev Sets the governance max supply. Only governance can do it.
     */
    function setGovMaxSupply(uint256 _govMaxSupply) external onlyOwner {
        emit GovMaxSupplyChanged(govMaxSupply, _govMaxSupply);
        govMaxSupply = _govMaxSupply;
    }

    /**
     * @dev Sets the mint ratio of AURA-BAL, with 18 decimal points.
     */
    function setMintRatio(uint256 _mintRatio) external onlyOwner {
        emit MintRatioChanged(mintRatio, _mintRatio);
        mintRatio = _mintRatio;
    }

    /**
     * @dev Mints AURA to a given user based on the BAL supply schedule.
     * It allos to premint an arbitrary number of tokens if total supply is 0.
     * After initial mint, it mints 1.62762546 AURA  per BAL, so in 6 years the ramaining 50,000,000 will be emitted.
     */
    function mint(address _to, uint256 _amount) external {
        uint256 supply = totalSupply() - _govTotalSupply;
        // validate if the emissions max supply has been reached.
        if (msg.sender != operator || EMISSIONS_MAX_SUPPLY <= supply) {
            //dont error just return. if a shutdown happens, rewards on old system
            //can still be claimed, just wont mint cvx
            return;
        }
        if (supply == 0) {
            //premine, one time only
            _mint(_to, _amount);
            //automatically switch operators
            updateOperator();
            return;
        }

        uint256 amtTillMax = EMISSIONS_MAX_SUPPLY.sub(supply);
        uint256 amount = _amount.mul(mintRatio).div(1e18);
        //dust check
        if (amount > amtTillMax) {
            amount = amtTillMax;
        }
        //supply cap check
        if (amount > 0) {
            _mint(_to, amount);
        }
    }

    /**
     * @dev Mints AURA to a given user, capped to `govMaxSupply`.
     */
    function governanceMint(address _to, uint256 _amount) external onlyOwner {
        //supply cap check
        require(_amount <= govMaxSupply.sub(_govTotalSupply), "token max supply");
        _govTotalSupply += _amount;
        _mint(_to, _amount);
    }
}
