// The request, including any password, is read from stdin. The static helper
// command therefore never places credentials in argv or the process list.
export const WINDOWS_NATIVE_WIFI_HELPER = String.raw`
$ErrorActionPreference = 'Stop'
$nativeAssembly = Join-Path ([System.IO.Path]::GetTempPath()) 'EideticPlayer.NativeWifi.2.12.1.dll'
$nativeSource = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security;

public static class EideticNativeWifi {
  const int ClientVersion = 2;
  const int AvailableIncludeAll = 3;
  const int OpcodeRadioState = 4;

  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  struct InterfaceInfo {
    public Guid Guid;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=256)] public string Description;
    public int State;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct Dot11Ssid {
    public uint Length;
    [MarshalAs(UnmanagedType.ByValArray, SizeConst=32)] public byte[] Value;
  }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  struct AvailableNetwork {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=256)] public string Profile;
    public Dot11Ssid Ssid;
    public int BssType;
    public uint BssidCount;
    public bool Connectable;
    public uint Reason;
    public uint PhyCount;
    [MarshalAs(UnmanagedType.ByValArray, SizeConst=8)] public uint[] Phys;
    public bool MorePhys;
    public uint Signal;
    public bool SecurityEnabled;
    public uint Auth;
    public uint Cipher;
    public uint Flags;
    public uint Reserved;
  }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  struct ConnectionParameters {
    public int Mode;
    [MarshalAs(UnmanagedType.LPWStr)] public string Profile;
    public IntPtr Ssid;
    public IntPtr DesiredBssidList;
    public int BssType;
    public int Flags;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct RadioState {
    public uint NumberOfPhys;
    [MarshalAs(UnmanagedType.ByValArray, SizeConst=64)] public Dot11RadioState[] States;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct Dot11RadioState {
    public uint PhyIndex;
    public int Software;
    public int Hardware;
  }
  public sealed class InterfaceResult {
    public string Id;
    public string Name;
    public int State;
  }
  public sealed class NetworkResult {
    public string Ssid;
    public int Signal;
    public uint Auth;
    public bool Connected;
    public string Profile;
  }
  public sealed class RadioResult {
    public string Software;
    public string Hardware;
  }

  [DllImport("wlanapi.dll")] static extern uint WlanOpenHandle(uint version, IntPtr reserved, out uint negotiated, out IntPtr handle);
  [DllImport("wlanapi.dll")] static extern uint WlanCloseHandle(IntPtr handle, IntPtr reserved);
  [DllImport("wlanapi.dll")] static extern uint WlanEnumInterfaces(IntPtr handle, IntPtr reserved, out IntPtr list);
  [DllImport("wlanapi.dll")] static extern uint WlanGetAvailableNetworkList(IntPtr handle, ref Guid guid, uint flags, IntPtr reserved, out IntPtr list);
  [DllImport("wlanapi.dll")] static extern uint WlanScan(IntPtr handle, ref Guid guid, IntPtr ssid, IntPtr ieData, IntPtr reserved);
  [DllImport("wlanapi.dll")] static extern uint WlanDisconnect(IntPtr handle, ref Guid guid, IntPtr reserved);
  [DllImport("wlanapi.dll", CharSet=CharSet.Unicode)] static extern uint WlanDeleteProfile(IntPtr handle, ref Guid guid, string profile, IntPtr reserved);
  [DllImport("wlanapi.dll", CharSet=CharSet.Unicode)] static extern uint WlanSetProfile(IntPtr handle, ref Guid guid, uint flags, string xml, string security, bool overwrite, IntPtr reserved, out uint reason);
  [DllImport("wlanapi.dll")] static extern uint WlanConnect(IntPtr handle, ref Guid guid, ref ConnectionParameters parameters, IntPtr reserved);
  [DllImport("wlanapi.dll")] static extern uint WlanQueryInterface(IntPtr handle, ref Guid guid, int opcode, IntPtr reserved, out uint size, out IntPtr data, out int valueType);
  [DllImport("wlanapi.dll")] static extern uint WlanSetInterface(IntPtr handle, ref Guid guid, int opcode, uint size, IntPtr data, IntPtr reserved);
  [DllImport("wlanapi.dll")] static extern void WlanFreeMemory(IntPtr value);

  static IntPtr Open() {
    uint negotiated; IntPtr handle;
    uint result = WlanOpenHandle(ClientVersion, IntPtr.Zero, out negotiated, out handle);
    if (result != 0) throw new InvalidOperationException("native-wifi-" + result);
    return handle;
  }
  static Guid Parse(string value) { return new Guid(value); }

  public static InterfaceResult[] Interfaces() {
    IntPtr handle = Open(), list = IntPtr.Zero;
    try {
      uint result = WlanEnumInterfaces(handle, IntPtr.Zero, out list);
      if (result != 0) throw new InvalidOperationException("native-wifi-" + result);
      int count = Marshal.ReadInt32(list);
      int offset = 8, size = Marshal.SizeOf(typeof(InterfaceInfo));
      var output = new List<InterfaceResult>();
      for (int index = 0; index < count; index++) {
        var item = (InterfaceInfo)Marshal.PtrToStructure(IntPtr.Add(list, offset + index * size), typeof(InterfaceInfo));
        output.Add(new InterfaceResult { Id=item.Guid.ToString(), Name=item.Description, State=item.State });
      }
      return output.ToArray();
    } finally {
      if (list != IntPtr.Zero) WlanFreeMemory(list);
      WlanCloseHandle(handle, IntPtr.Zero);
    }
  }
  public static NetworkResult[] Networks(string id) {
    IntPtr handle = Open(), list = IntPtr.Zero;
    try {
      Guid guid = Parse(id);
      uint result = WlanGetAvailableNetworkList(handle, ref guid, AvailableIncludeAll, IntPtr.Zero, out list);
      if (result != 0) throw new InvalidOperationException("native-wifi-" + result);
      int count = Marshal.ReadInt32(list);
      int offset = 8, size = Marshal.SizeOf(typeof(AvailableNetwork));
      var output = new List<NetworkResult>();
      for (int index = 0; index < count; index++) {
        var item = (AvailableNetwork)Marshal.PtrToStructure(IntPtr.Add(list, offset + index * size), typeof(AvailableNetwork));
        string ssid = System.Text.Encoding.UTF8.GetString(item.Ssid.Value, 0, (int)item.Ssid.Length);
        if (ssid.Length > 0) output.Add(new NetworkResult {
          Ssid=ssid, Signal=(int)item.Signal, Auth=item.Auth,
          Connected=(item.Flags & 1) != 0, Profile=item.Profile ?? ""
        });
      }
      return output.ToArray();
    } finally {
      if (list != IntPtr.Zero) WlanFreeMemory(list);
      WlanCloseHandle(handle, IntPtr.Zero);
    }
  }
  public static RadioResult Radio(string id) {
    IntPtr handle = Open(), data = IntPtr.Zero;
    try {
      Guid guid = Parse(id); uint size; int valueType;
      uint result = WlanQueryInterface(handle, ref guid, OpcodeRadioState, IntPtr.Zero, out size, out data, out valueType);
      if (result != 0) throw new InvalidOperationException("native-wifi-" + result);
      var state = (RadioState)Marshal.PtrToStructure(data, typeof(RadioState));
      bool software = true, hardware = true;
      for (int i=0; i < state.NumberOfPhys; i++) {
        software = software && state.States[i].Software == 1;
        hardware = hardware && state.States[i].Hardware == 1;
      }
      return new RadioResult { Software=software ? "on" : "off", Hardware=hardware ? "on" : "off" };
    } finally {
      if (data != IntPtr.Zero) WlanFreeMemory(data);
      WlanCloseHandle(handle, IntPtr.Zero);
    }
  }
  public static void Scan(string id) {
    IntPtr handle = Open();
    try { Guid guid=Parse(id); uint result=WlanScan(handle, ref guid, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero); if(result != 0) throw new InvalidOperationException("native-wifi-"+result); }
    finally { WlanCloseHandle(handle, IntPtr.Zero); }
  }
  public static void Disconnect(string id) {
    IntPtr handle = Open();
    try { Guid guid=Parse(id); uint result=WlanDisconnect(handle, ref guid, IntPtr.Zero); if(result != 0) throw new InvalidOperationException("native-wifi-"+result); }
    finally { WlanCloseHandle(handle, IntPtr.Zero); }
  }
  public static void Delete(string id, string profile) {
    IntPtr handle = Open();
    try { Guid guid=Parse(id); uint result=WlanDeleteProfile(handle, ref guid, profile, IntPtr.Zero); if(result != 0 && result != 1168) throw new InvalidOperationException("native-wifi-"+result); }
    finally { WlanCloseHandle(handle, IntPtr.Zero); }
  }
  public static void RadioSet(string id, bool enabled) {
    IntPtr handle = Open(), original = IntPtr.Zero, data = IntPtr.Zero;
    try {
      Guid guid=Parse(id); uint size; int valueType;
      uint result=WlanQueryInterface(handle, ref guid, OpcodeRadioState, IntPtr.Zero, out size, out original, out valueType);
      if(result != 0) throw new InvalidOperationException("native-wifi-"+result);
      var state=(RadioState)Marshal.PtrToStructure(original, typeof(RadioState));
      for(int i=0;i<state.NumberOfPhys;i++) state.States[i].Software=enabled ? 1 : 2;
      data=Marshal.AllocHGlobal(Marshal.SizeOf(typeof(RadioState)));
      Marshal.StructureToPtr(state, data, false);
      result=WlanSetInterface(handle, ref guid, OpcodeRadioState, (uint)Marshal.SizeOf(typeof(RadioState)), data, IntPtr.Zero);
      if(result != 0) throw new InvalidOperationException("native-wifi-"+result);
    } finally {
      if(original != IntPtr.Zero) WlanFreeMemory(original);
      if(data != IntPtr.Zero) Marshal.FreeHGlobal(data);
      WlanCloseHandle(handle, IntPtr.Zero);
    }
  }
  static string ProfileXml(string profile, string ssid, string security, string password, bool hidden) {
    string p=SecurityElement.Escape(profile), s=SecurityElement.Escape(ssid), key=SecurityElement.Escape(password ?? "");
    string auth=security == "wpa3-personal" ? "WPA3SAE" : "WPA2PSK";
    string securityXml=security == "open"
      ? "<security><authEncryption><authentication>open</authentication><encryption>none</encryption><useOneX>false</useOneX></authEncryption></security>"
      : "<security><authEncryption><authentication>"+auth+"</authentication><encryption>AES</encryption><useOneX>false</useOneX></authEncryption><sharedKey><keyType>passPhrase</keyType><protected>false</protected><keyMaterial>"+key+"</keyMaterial></sharedKey></security>";
    return "<?xml version=\"1.0\"?><WLANProfile xmlns=\"http://www.microsoft.com/networking/WLAN/profile/v1\"><name>"+p+"</name><SSIDConfig><SSID><name>"+s+"</name></SSID><nonBroadcast>"+(hidden?"true":"false")+"</nonBroadcast></SSIDConfig><connectionType>ESS</connectionType><connectionMode>manual</connectionMode><MSM>"+securityXml+"</MSM></WLANProfile>";
  }
  public static void SetProfileConnect(string id, string profile, string ssid, string security, string password, bool hidden) {
    IntPtr handle=Open();
    try {
      Guid guid=Parse(id); uint reason;
      uint result=WlanSetProfile(handle, ref guid, 0, ProfileXml(profile, ssid, security, password, hidden), null, true, IntPtr.Zero, out reason);
      if(result != 0) throw new InvalidOperationException("native-wifi-"+result);
      var parameters=new ConnectionParameters { Mode=0, Profile=profile, Ssid=IntPtr.Zero, DesiredBssidList=IntPtr.Zero, BssType=1, Flags=0 };
      result=WlanConnect(handle, ref guid, ref parameters, IntPtr.Zero);
      if(result != 0) throw new InvalidOperationException("native-wifi-"+result);
    } finally { WlanCloseHandle(handle, IntPtr.Zero); }
  }
}
'@
if (Test-Path -LiteralPath $nativeAssembly) {
  Add-Type -Path $nativeAssembly
} else {
  Add-Type -TypeDefinition $nativeSource -OutputAssembly $nativeAssembly
  Add-Type -Path $nativeAssembly
}
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
switch ($request.action) {
  'state' {
    $wifi = @([EideticNativeWifi]::Interfaces())
    $adapters = @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue | ForEach-Object {
      $ip = Get-NetIPConfiguration -InterfaceIndex $_.ifIndex -ErrorAction SilentlyContinue
      $address = @($ip.IPv4Address)[0]
      $method = if ((Get-NetIPInterface -InterfaceIndex $_.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue).Dhcp -eq 'Enabled') { 'dhcp' } else { 'manual' }
      [pscustomobject]@{
        nativeId = if ($_.InterfaceGuid) { $_.InterfaceGuid.ToString() } else { '' }
        name = $_.InterfaceDescription
        type = if ($_.NdisPhysicalMedium -eq 9 -or $_.InterfaceDescription -match 'Wi-Fi|Wireless|802.11') { 'wifi' } else { 'wired' }
        enabled = $_.Status -ne 'Disabled'
        connected = $_.Status -eq 'Up'
        speed = if ($_.LinkSpeed) { $_.LinkSpeed } else { $null }
        method = $method
        address = if ($address) { $address.IPAddress } else { $null }
        prefix = if ($address) { $address.PrefixLength } else { $null }
        gateway = if ($ip.IPv4DefaultGateway) { $ip.IPv4DefaultGateway.NextHop } else { $null }
        dns = @($ip.DNSServer.ServerAddresses | Where-Object { $_ -match '^\d+\.' } | Select-Object -First 2)
      }
    })
    $native = @($wifi | ForEach-Object {
      $networks = @([EideticNativeWifi]::Networks($_.Id))
      [pscustomobject]@{ id=$_.Id; name=$_.Name; state=$_.State; radio=[EideticNativeWifi]::Radio($_.Id); networks=$networks }
    })
    $profiles = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue)
    $connectivity = if ($profiles.IPv4Connectivity -contains 'Internet' -or $profiles.IPv6Connectivity -contains 'Internet') { 'internet' } elseif ($profiles.Count -gt 0) { 'local-network' } else { 'disconnected' }
    $managed = @($native.networks | Where-Object { $_.Connected -and $_.Profile -eq 'Eidetic Player Wi-Fi' }).Count -gt 0
    [pscustomobject]@{ adapters=$adapters; nativeWifi=$native; managed=$managed; connectivity=$connectivity } | ConvertTo-Json -Depth 8 -Compress
  }
  'scan' { [EideticNativeWifi]::Scan($request.nativeId) }
  'radio' { [EideticNativeWifi]::RadioSet($request.nativeId, [bool]$request.enabled) }
  'disconnect' { [EideticNativeWifi]::Disconnect($request.nativeId) }
  'forget' { [EideticNativeWifi]::Delete($request.nativeId, 'Eidetic Player Wi-Fi') }
  'connect' {
    $pending = 'Eidetic Player Wi-Fi pending'
    try {
      [EideticNativeWifi]::Delete($request.nativeId, $pending)
      [EideticNativeWifi]::SetProfileConnect($request.nativeId, $pending, $request.ssid, $request.security, $request.password, [bool]$request.hidden)
      $accepted = $false
      for ($attempt = 0; $attempt -lt 20; $attempt++) {
        Start-Sleep -Milliseconds 500
        $accepted = @([EideticNativeWifi]::Networks($request.nativeId) | Where-Object { $_.Connected -and $_.Ssid -eq $request.ssid }).Count -gt 0
        if ($accepted) { break }
      }
      if (-not $accepted) { throw 'connection-timeout' }
      [EideticNativeWifi]::SetProfileConnect($request.nativeId, 'Eidetic Player Wi-Fi', $request.ssid, $request.security, $request.password, [bool]$request.hidden)
      Start-Sleep -Milliseconds 500
      [EideticNativeWifi]::Delete($request.nativeId, $pending)
    } catch {
      [EideticNativeWifi]::Delete($request.nativeId, $pending)
      throw
    }
  }
}
`;
