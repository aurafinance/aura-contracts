// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
}

interface IL1Coordinator {
    function balBalance() external view returns (uint256);

    function feeDebtOf(uint16) external view returns (uint256);

    function settledFeeDebtOf(uint16) external view returns (uint256);

    function distributedFeeDebtOf(uint16) external view returns (uint256);

    function bridgeDelegates(uint16) external view returns (address);

    function l2Coordinators(uint16) external view returns (address);
}

interface IProxyOFT {
    function getCurrentEpoch() external view returns (uint256);

    function circulatingSupply() external view returns (uint256);

    function inflowLimit() external view returns (uint256);

    function outflow(uint256) external view returns (uint256);

    function inflow(uint256) external view returns (uint256);

    function paused() external view returns (bool);
}

interface IAuraBalProxyOFT {
    function totalClaimable(address) external view returns (uint256);

    function internalTotalSupply() external view returns (uint256);

    function claimable(address, uint16) external view returns (uint256);
}

interface IAurabalVault {
    function balanceOfUnderlying(address) external view returns (uint256);
}

struct L1CoordSidechainData {
    uint16 sidechainId;
    uint256 bridgeDelegateBalBalance;
    uint256 feeDebtOf;
    uint256 settledFeeDebtOf;
    uint256 distributedFeeDebtOf;
    address bridgeDelegate;
    address l2Coordinator;
}

struct L1CoordData {
    uint256 balBalance;
}

struct AuraProxyOftData {
    uint256 epoch;
    uint256 circulatingSupply;
    uint256 inflowLimit;
    uint256 outflow;
    uint256 inflow;
    bool paused;
    uint256 auraProxyOFTAuraBalance;
}

struct AuraBalProxyOftData {
    uint256 epoch;
    uint256 circulatingSupply;
    uint256 inflowLimit;
    uint256 outflow;
    uint256 inflow;
    bool paused;
    uint256 totalClaimableAuraBal;
    uint256 totalClaimableAura;
    uint256 internalTotalSupply;
    uint256 auraBalBalance;
    uint256 auraBalance;
    uint256 auraBalVaultBalance;
    uint256 auraBalVaultBalanceOfUnderlying;
}

struct AurabalProxySidechainInfo {
    uint16 sidechainId;
    uint256 claimableAuraBal;
    uint256 claimableAura;
}

struct CananonicalData {
    L1CoordData l1coordinator;
    L1CoordSidechainData[] l1CoordinatorSidechainData;
    AuraProxyOftData auraProxyOft;
    AuraBalProxyOftData aurabalProxyOft;
    AurabalProxySidechainInfo[] aurabalProxySidechainData;
}

contract CanonicalView {
    address public immutable aura;
    address public immutable auraProxyOft;
    address public immutable auraBalProxyOft;
    address public immutable aurabal;
    address public immutable aurabalVault;
    address public immutable bal;
    address public immutable l1Coordinator;

    constructor(
        address _aura,
        address _auraProxyOft,
        address _auraBalProxyOft,
        address _aurabal,
        address _aurabalVault,
        address _bal,
        address _l1Coordinator
    ) {
        aura = _aura;
        auraProxyOft = _auraProxyOft;
        auraBalProxyOft = _auraBalProxyOft;
        aurabal = _aurabal;
        aurabalVault = _aurabalVault;
        bal = _bal;
        l1Coordinator = _l1Coordinator;
    }

    function getL1CoordData() public view returns (L1CoordData memory data) {
        data.balBalance = IERC20(bal).balanceOf(l1Coordinator);
    }

    function getL1CoordSidechainData(uint16 sidechainId) public view returns (L1CoordSidechainData memory data) {
        data.sidechainId = sidechainId;
        data.feeDebtOf = IL1Coordinator(l1Coordinator).feeDebtOf(sidechainId);
        data.settledFeeDebtOf = IL1Coordinator(l1Coordinator).settledFeeDebtOf(sidechainId);
        data.distributedFeeDebtOf = IL1Coordinator(l1Coordinator).distributedFeeDebtOf(sidechainId);
        data.bridgeDelegate = IL1Coordinator(l1Coordinator).bridgeDelegates(sidechainId);
        data.l2Coordinator = IL1Coordinator(l1Coordinator).l2Coordinators(sidechainId);
        data.feeDebtOf = IERC20(bal).balanceOf(data.bridgeDelegate);
    }

    function getAuraProxyOftData() public view returns (AuraProxyOftData memory data) {
        IProxyOFT proxyOft = IProxyOFT(auraProxyOft);
        data.epoch = proxyOft.getCurrentEpoch();
        data.circulatingSupply = proxyOft.circulatingSupply();
        data.inflowLimit = proxyOft.inflowLimit();
        data.outflow = proxyOft.outflow(data.epoch);
        data.inflow = proxyOft.inflow(data.epoch);
        data.paused = proxyOft.paused();
        data.auraProxyOFTAuraBalance = IERC20(aura).balanceOf(auraProxyOft);
    }

    function getAuraBalProxyOftData() public view returns (AuraBalProxyOftData memory data) {
        IProxyOFT proxyOft = IProxyOFT(auraBalProxyOft);
        data.epoch = proxyOft.getCurrentEpoch();
        data.circulatingSupply = proxyOft.circulatingSupply();
        data.inflowLimit = proxyOft.inflowLimit();
        data.outflow = proxyOft.outflow(data.epoch);
        data.inflow = proxyOft.inflow(data.epoch);
        data.paused = proxyOft.paused();

        IAuraBalProxyOFT _auraBalProxyOft = IAuraBalProxyOFT(auraProxyOft);
        data.totalClaimableAuraBal = _auraBalProxyOft.totalClaimable(aurabal);
        data.totalClaimableAura = _auraBalProxyOft.totalClaimable(aura);
        data.internalTotalSupply = _auraBalProxyOft.internalTotalSupply();

        data.auraBalBalance = IERC20(aurabal).balanceOf(auraBalProxyOft);
        data.auraBalance = IERC20(aura).balanceOf(auraBalProxyOft);
        data.auraBalVaultBalance = IERC20(aurabalVault).balanceOf(auraBalProxyOft);
        data.auraBalVaultBalanceOfUnderlying = IAurabalVault(aurabalVault).balanceOfUnderlying(auraBalProxyOft);
    }

    function getAuraBalProxySidechainData(uint16 sidechainId)
        public
        view
        returns (AurabalProxySidechainInfo memory data)
    {
        data.sidechainId = sidechainId;
        IAuraBalProxyOFT _auraBalProxyOft = IAuraBalProxyOFT(auraProxyOft);
        data.claimableAuraBal = _auraBalProxyOft.claimable(aurabal, sidechainId);
        data.claimableAura = _auraBalProxyOft.claimable(aura, sidechainId);
    }

    function getCanonicalData(uint16[] memory sidechainIds) public view returns (CananonicalData memory data) {
        data.l1coordinator = getL1CoordData();
        data.auraProxyOft = getAuraProxyOftData();
        data.aurabalProxyOft = getAuraBalProxyOftData();

        data.l1CoordinatorSidechainData = new L1CoordSidechainData[](sidechainIds.length);
        data.aurabalProxySidechainData = new AurabalProxySidechainInfo[](sidechainIds.length);

        for (uint256 i = 0; i < sidechainIds.length; i++) {
            data.l1CoordinatorSidechainData[i] = getL1CoordSidechainData(sidechainIds[i]);
            data.aurabalProxySidechainData[i] = getAuraBalProxySidechainData(sidechainIds[i]);
        }
    }
}
