#cloud-config
# Rendered by Packer from build variables. Do not put a credential in this file:
# it is committed to the repository, and the scaffold previously shipped
# "$6$rounds=4096$REPLACE$ME" here, which fails the install outright.
#
# build_password_hash is a SHA-512 crypt hash, produced on any Linux box with:
#     mkpasswd -m sha-512
# It is a BUILD-time credential only. 99-seal.sh locks this account before the
# image is exported, so it never reaches a customer.
autoinstall:
  version: 1
  locale: en_US.UTF-8
  keyboard:
    layout: us
  network:
    version: 2
    ethernets:
      any:
        match:
          name: "en*"
        dhcp4: true
  ssh:
    install-server: true
    allow-pw: true
  storage:
    layout:
      name: lvm
  identity:
    hostname: appliance-build
    username: ${build_user}
    password: "${build_password_hash}"
  packages:
    - open-vm-tools
    - python3
    - curl
    - ca-certificates
  user-data:
    disable_root: true
  late-commands:
    # subiquity's lvm layout allocates only part of the volume group to the root
    # logical volume. On the 40 GB virtual disk this build declares, that left
    # root at 19 GB with the rest of the disk sitting unused inside the VG,
    # which the appliance console then reports to the customer as "11G free of
    # 19G" on a machine they were told has 40 GB. Neither command is fatal: on a
    # disk with nothing free, lvextend exits non zero and that is correct.
    - curtin in-target --target=/target -- sh -c 'lvextend -l +100%FREE /dev/mapper/ubuntu--vg-ubuntu--lv || true'
    - curtin in-target --target=/target -- sh -c 'resize2fs /dev/mapper/ubuntu--vg-ubuntu--lv || true'
    - echo '${build_user} ALL=(ALL) NOPASSWD:ALL' > /target/etc/sudoers.d/${build_user}
    - chmod 440 /target/etc/sudoers.d/${build_user}
