#!/bin/bash
# A VM do Windows 11 (VirtualBox "mybots-windows") para testar o MyBots no Windows de verdade. Use SEMPRE este script, nunca `VBoxManage startvm`.
#
# Por quê: a VM nasceu de um instalador autônomo (WillWipeDisk=true) que ficou plugado como DVD. Quando o firmware escolhe o DVD em vez do
# disco, ele apaga o disco e reinstala o Windows (aconteceu em 14/11/2026, ao ligar a VM). Aqui:
#   - `start` só liga se a VM estiver marcada como instalada; antes de ligar, tira o DVD e fixa o boot só pelo disco;
#   - `snapshot`/`restore` guardam e voltam a VM limpa em segundos, em vez de reinstalar.
#
# Uso: windows-vm.sh status | start [--tela] | stop | marcar-instalada | snapshot [nome] | restore [nome]
#                    | run <programa> [args…]   (roda dentro do Windows, como o usuário mybots)
#                    | copiar <arquivo-daqui> <pasta-no-windows>
#                    | pegar <arquivo-no-windows> <pasta-daqui>
#                    | tela <arquivo.png>
set -euo pipefail
VM=mybots-windows
DIR="$HOME/VirtualBox VMs/$VM"
SENHA="$DIR/senha-vm.txt"      # só a senha do usuário mybots; fica fora do repositório
USUARIO=mybots
SNAPSHOT_PADRAO=limpa
estado() { VBoxManage showvminfo "$VM" --machinereadable | sed -n 's/^VMState="\(.*\)"/\1/p'; }
instalada() { [ "$(VBoxManage getextradata "$VM" mybots/instalada 2>/dev/null | sed -n 's/^Value: //p')" = sim ]; }
guest() { VBoxManage guestcontrol "$VM" "$@" --username "$USUARIO" --passwordfile "$SENHA"; }

# O DVD de instalação nunca pode ficar plugado depois de instalada, e o boot é só pelo disco.
travar_boot() {
  if VBoxManage showvminfo "$VM" --machinereadable | grep -q '^"SATA-1-0"="[^n]'; then
    VBoxManage storageattach "$VM" --storagectl SATA --port 1 --device 0 --medium emptydrive --forceunmount
    echo "Tirei o DVD de instalação da VM."
  fi
  VBoxManage modifyvm "$VM" --boot1 disk --boot2 none --boot3 none --boot4 none
}

case "${1:-status}" in
  status)
    echo "estado: $(estado) · instalada: $(instalada && echo sim || echo NÃO)"
    VBoxManage showvminfo "$VM" --machinereadable | grep -E '^"SATA-1-0"|^boot[1-4]=' | tr '\n' ' '; echo
    VBoxManage snapshot "$VM" list 2>&1 | head -5 ;;
  start)
    case "$(estado)" in poweroff|aborted|saved|aborted-saved) ;; *) echo "A VM já está ligada ($(estado))."; exit 0 ;; esac
    if ! instalada; then
      echo "RECUSEI ligar: a VM não está marcada como instalada, e ligar pode apagar o disco e reinstalar o Windows." >&2
      echo "Se ela está certa e o Windows abre, rode: $0 marcar-instalada (com ela ligada) — ou restaure o snapshot: $0 restore." >&2
      exit 1
    fi
    travar_boot
    VBoxManage startvm "$VM" --type "$([ "${2:-}" = --tela ] && echo gui || echo headless)"
    echo "Ligada. Confira com: $0 tela /tmp/vm.png (e olhe a imagem) antes de dizer que está tudo bem." ;;
  stop)
    VBoxManage controlvm "$VM" acpipowerbutton ;;
  marcar-instalada)
    # Só marca com o Windows de pé e as Guest Additions respondendo (nada de marcar no meio da instalação).
    guest run --exe 'C:\Windows\System32\cmd.exe' -- cmd.exe /c ver | tail -2
    travar_boot
    VBoxManage setextradata "$VM" mybots/instalada sim
    echo "Marcada como instalada. Agora rode: $0 snapshot" ;;
  snapshot)
    VBoxManage snapshot "$VM" take "${2:-$SNAPSHOT_PADRAO}" ;;
  restore)
    case "$(estado)" in poweroff|aborted|saved|aborted-saved) ;; *) VBoxManage controlvm "$VM" poweroff; sleep 3 ;; esac
    VBoxManage snapshot "$VM" restore "${2:-$SNAPSHOT_PADRAO}" ;;
  run)
    shift; prog=$1; shift
    guest run --exe "$prog" --wait-stdout --wait-stderr -- "$prog" "$@" ;;
  copiar)
    guest copyto --target-directory "$3" "$2" ;;
  pegar)
    guest copyfrom --target-directory "$3" "$2" ;;
  tela)
    VBoxManage controlvm "$VM" screenshotpng "${2:-/tmp/vm.png}" ;;
  *) sed -n 2,16p "$0"; exit 2 ;;
esac
