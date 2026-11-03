"""
Procedural 3D SDF Raymarcher for Studio Headphones (360-degree vertical-axis turntable).
Offline pure-Python (NumPy + Pillow + FFmpeg) volumetric 3D renderer.
No Three.js, no 2D image warping: genuine 3D CSG solid geometry with perspective camera,
true 3D occlusion, surface normals, raymarched ambient occlusion, soft shadows, and studio lighting.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import math
import os
import subprocess
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

# Material IDs
MAT_HOUSING = 1        # Warm olive-taupe studio shell (midtone)
MAT_HOUSING_LIGHT = 2  # Bright warm cream-beige baffle / trim
MAT_PAD = 3            # Matte dark-charcoal plush earpad & headband leather
MAT_METAL = 4          # Brushed cream-silver steel headband rails & wishbone yoke
MAT_GOLD = 5           # Gleaming Gruvbox amber-gold rings, pivots & TRS plug
MAT_GRILLE = 6         # Dark recessed studio acoustic grille with raised louvers
MAT_CABLE = 7          # Braided warm-gold studio audio cord


def _precompute_cable_segments() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Build 3D cubic Bezier curve segments for the left-earcup studio cable."""
    p0 = np.array([-0.635, -0.715, -0.020], dtype=np.float32)
    p1 = np.array([-0.625, -0.945, 0.085], dtype=np.float32)
    p2 = np.array([-0.340, -0.955, 0.235], dtype=np.float32)
    p3 = np.array([-0.145, -0.875, 0.205], dtype=np.float32)

    n_seg = 12
    ts = np.linspace(0.0, 1.0, n_seg + 1, dtype=np.float32)[:, None]
    pts = (
        ((1.0 - ts) ** 3) * p0
        + 3.0 * ((1.0 - ts) ** 2) * ts * p1
        + 3.0 * (1.0 - ts) * (ts ** 2) * p2
        + (ts ** 3) * p3
    )
    a = pts[:-1]
    b = pts[1:]
    ba = b - a
    baba = np.sum(ba * ba, axis=-1)
    return a, ba, baba


CABLE_A, CABLE_BA, CABLE_BABA = _precompute_cable_segments()

PLUG_BARREL_A = np.array([-0.150, -0.878, 0.203], dtype=np.float32)
PLUG_BARREL_B = np.array([-0.025, -0.822, 0.258], dtype=np.float32)
PLUG_TIP_A = np.array([-0.025, -0.822, 0.258], dtype=np.float32)
PLUG_TIP_B = np.array([0.078, -0.776, 0.304], dtype=np.float32)


def sd_capsule(px: np.ndarray, py: np.ndarray, pz: np.ndarray, a: np.ndarray, b: np.ndarray, r: float) -> np.ndarray:
    pax = px - a[0]
    pay = py - a[1]
    paz = pz - a[2]
    bax = float(b[0] - a[0])
    bay = float(b[1] - a[1])
    baz = float(b[2] - a[2])
    baba = bax * bax + bay * bay + baz * baz
    h = np.clip((pax * bax + pay * bay + paz * baz) / baba, 0.0, 1.0)
    dx = pax - bax * h
    dy = pay - bay * h
    dz = paz - baz * h
    return np.sqrt(dx * dx + dy * dy + dz * dz) - r


def evaluate_sdf(px: np.ndarray, py: np.ndarray, pz: np.ndarray, return_mat: bool = False):
    """
    Evaluate 3D Signed Distance Field of the studio monitor headphones in object space.
    """
    sx = np.abs(px)

    # ------------------------------------------------------------------
    # 1. HEADBAND ASSEMBLY (Tilted 5 deg backward at apex for natural 3D stance)
    # ------------------------------------------------------------------
    ca_hb = 0.9961947
    sa_hb = 0.0871557
    dy_hb0 = py - 0.05
    py_hb = dy_hb0 * ca_hb - pz * sa_hb + 0.05
    pz_hb = dy_hb0 * sa_hb + pz * ca_hb

    above = py_hb >= 0.06
    arc_dy = py_hb - 0.06
    r_arch = np.sqrt(sx * sx + arc_dy * arc_dy)
    angle_arch = np.arctan2(np.maximum(arc_dy, 0.0), np.maximum(sx, 1e-6))

    # Twin brushed-steel outer rails along front & back edges of headband strap (MAT_METAL)
    rad_rail = np.where(above, r_arch - 0.755, sx - 0.755)
    y_cut_hb = np.maximum(-0.02 - py_hb, 0.0)
    rail_z_dist = np.abs(np.abs(pz_hb) - 0.098)
    q_rl_r = np.maximum(np.abs(rad_rail) - 0.022, 0.0)
    q_rl_z = np.maximum(rail_z_dist - 0.018, 0.0)
    d_hb_rails = np.sqrt(q_rl_r * q_rl_r + q_rl_z * q_rl_z + y_cut_hb * y_cut_hb) - 0.008

    # Top subtle metallic bridge plate near apex + lower band plate
    q_bp_r = np.maximum(np.abs(rad_rail + 0.004) - 0.013, 0.0)
    q_bp_z = np.maximum(np.abs(pz_hb) - 0.095, 0.0)
    d_hb_core = np.sqrt(q_bp_r * q_bp_r + q_bp_z * q_bp_z + y_cut_hb * y_cut_hb) - 0.006

    # Inner & center quilted dark leather headband cushion (MAT_PAD)
    # Visible both underneath the arch AND inset between the twin outer steel rails in 90-deg profile!
    quilt = 0.007 * np.cos(angle_arch * 14.0)
    taper = np.clip((angle_arch - 0.16) * 3.2, 0.0, 1.0)
    pad_thick = (0.042 + quilt) * taper
    rad_pad = r_arch - 0.720
    ang_excess = np.maximum(0.16 - angle_arch, 0.0) * 0.72
    q_p_r = np.maximum(np.abs(rad_pad) - pad_thick, 0.0)
    q_p_z = np.maximum(np.abs(pz_hb) - 0.106, 0.0)
    d_headband_pad = np.sqrt(q_p_r * q_p_r + q_p_z * q_p_z + ang_excess * ang_excess) - 0.014

    # Dark leather inset strap visible between the twin steel rails all the way down to clamp
    q_in_r = np.maximum(np.abs(rad_rail) - 0.019, 0.0)
    q_in_z = np.maximum(np.abs(pz_hb) - 0.076, 0.0)
    d_hb_inset = np.sqrt(q_in_r * q_in_r + q_in_z * q_in_z + y_cut_hb * y_cut_hb) - 0.006
    d_headband_pad = np.minimum(d_headband_pad, d_hb_inset)

    # Warm gold accent crown strip on front-top of headband (MAT_GOLD)
    ang_crown = np.maximum(0.45 - angle_arch, 0.0) * 0.75
    d_hb_piping = np.sqrt((r_arch - 0.742) ** 2 + (pz_hb - 0.116) ** 2 + ang_crown ** 2) - 0.011

    # Side adjustment clamp blocks at (sx=0.748, py_hb=-0.025, pz_hb=0.0) (MAT_HOUSING_LIGHT)
    qx_cl = np.maximum(np.abs(sx - 0.748) - 0.040, 0.0)
    qy_cl = np.maximum(np.abs(py_hb + 0.025) - 0.064, 0.0)
    qz_cl = np.maximum(np.abs(pz_hb) - 0.122, 0.0)
    d_clamp = np.sqrt(qx_cl * qx_cl + qy_cl * qy_cl + qz_cl * qz_cl) - 0.013

    # Gold collar band at bottom of clamp block (MAT_GOLD)
    qx_gc = np.maximum(np.abs(sx - 0.746) - 0.044, 0.0)
    qy_gc = np.maximum(np.abs(py_hb + 0.090) - 0.012, 0.0)
    qz_gc = np.maximum(np.abs(pz_hb) - 0.125, 0.0)
    d_clamp_gold = np.sqrt(qx_gc * qx_gc + qy_gc * qy_gc + qz_gc * qz_gc) - 0.006

    # Brushed steel slider rod connecting clamp to yoke wishbone (MAT_METAL)
    rod_y = np.clip(py, -0.155, -0.075)
    d_slider_rod = np.sqrt((sx - 0.738) ** 2 + (py - rod_y) ** 2 + (pz - 0.005) ** 2) - 0.027

    # ------------------------------------------------------------------
    # 2. CHUNKY STUDIO EARCUP LOCAL FRAME (Inward tilt 11 deg + Front toe-in 15 deg)
    # ------------------------------------------------------------------
    lx = sx - 0.678
    ly = py + 0.385
    lz = pz - 0.015

    # Inward bottom tilt (11 deg in XY)
    c_tilt = 0.9816272
    s_tilt = 0.1908090
    tx = lx * c_tilt - ly * s_tilt
    ey = lx * s_tilt + ly * c_tilt

    # Ergonomic Front Toe-In (15 deg in XZ: inner -ex face turns toward +Z front,
    # outer +ex shell turns slightly toward -Z back)
    c_toe = 0.9659258
    s_toe = 0.2588190
    ex = tx * c_toe - lz * s_toe
    ez = tx * s_toe + lz * c_toe

    # Stadium oval radial coordinate in (ey, ez) -> exact Euclidean 2D distance!
    ey_seg = np.maximum(np.abs(ey) - 0.078, 0.0)
    r_oval = np.sqrt(ey_seg * ey_seg + ez * ez)
    r_circ = np.sqrt(ey * ey + ez * ez)

    # A. Articulated U-Shaped Metal Wishbone Yoke Fork (MAT_METAL)
    yoke_ey = ey - 0.015
    r_yoke_2d = np.sqrt((yoke_ey / 0.315) ** 2 + (ez / 0.308) ** 2)
    d_yoke_ring = (r_yoke_2d - 1.0) * 0.305
    yoke_ex_center = 0.058 + 0.022 * np.clip(yoke_ey / 0.315, 0.0, 1.0)
    yoke_cut_bottom = np.maximum(-0.02 - yoke_ey, 0.0)
    d_yoke = np.sqrt(d_yoke_ring ** 2 + (ex - yoke_ex_center) ** 2 + yoke_cut_bottom ** 2) - 0.022

    stem_h = np.clip((ey - 0.295) / 0.065, 0.0, 1.0)
    d_yoke_stem = np.sqrt((ex - (0.075 - 0.015 * stem_h)) ** 2 + (ey - (0.295 + 0.065 * stem_h)) ** 2 + ez ** 2) - 0.026
    d_yoke = np.minimum(d_yoke, d_yoke_stem)

    # Machined Gold Pivot Pins at Front & Back of Wishbone Yoke (MAT_GOLD)
    piv_dz = np.maximum(np.abs(np.abs(ez) - 0.302) - 0.024, 0.0)
    piv_r = np.maximum(np.sqrt((ex - 0.055) ** 2 + ey ** 2) - 0.040, 0.0)
    d_pivots = np.sqrt(piv_dz * piv_dz + piv_r * piv_r) - 0.006

    # B. Thick Plush Circumaural Ear Cushion with Deep Hollow Cavity (MAT_PAD)
    d_earpad = np.sqrt((r_oval - 0.202) ** 2 + ((ex + 0.088) * 1.02) ** 2) - 0.068

    # C. Recessed Inner Acoustic Baffle + Bright Gold Studio Transducer Dome
    q_bf_r = np.maximum(r_oval - 0.210, 0.0)
    q_bf_x = np.maximum(np.abs(ex + 0.022) - 0.014, 0.0)
    d_baffle = np.sqrt(q_bf_r * q_bf_r + q_bf_x * q_bf_x) - 0.006
    d_baffle = d_baffle + 0.0035 * np.cos(r_circ * 54.0) * (r_circ < 0.175)

    d_driver_dome = np.sqrt(r_circ * r_circ + ((ex + 0.024) * 1.35) ** 2) - 0.068
    d_driver_ring = np.sqrt((r_circ - 0.105) ** 2 + (ex + 0.038) ** 2) - 0.010
    d_inner_gold = np.minimum(d_driver_dome, d_driver_ring)

    # D. Bright Cream-Beige Acoustic Mounting Flange (separates dark pad from shell!)
    q_fl_r = np.maximum(r_oval - 0.268, 0.0)
    q_fl_x = np.maximum(np.abs(ex - 0.012) - 0.018, 0.0)
    d_flange = np.sqrt(q_fl_r * q_fl_r + q_fl_x * q_fl_x) - 0.013

    # E. Deep Sculpted Outer Studio Monitor Shell (MAT_HOUSING)
    taper_shell = 0.242 - 0.22 * np.clip(ex - 0.028, 0.0, 0.16)
    q_sh_r = np.maximum(r_oval - taper_shell, 0.0)
    q_sh_x = np.maximum(np.abs(ex - 0.095) - 0.056, 0.0)
    d_shell = np.sqrt(q_sh_r * q_sh_r + q_sh_x * q_sh_x) - 0.028

    # Rear acoustic bass-reflex vents carved on the back half of the shell (ez < -0.12)
    rear_mask = (ez < -0.12) & (np.abs(ex - 0.092) < 0.038) & (np.abs(ey) < 0.14)
    vent_wave = np.maximum(0.0, np.sin(ey * 68.0)) * 0.009
    d_shell = d_shell + np.where(rear_mask, vent_wave, 0.0)

    # F. Gleaming Outer Gold Bezel Ring + Dark Recessed Grille + Gold Center Medallion
    d_outer_gold_ring = np.sqrt((r_oval - 0.184) ** 2 + (ex - 0.168) ** 2) - 0.019

    # Dark recessed slotted studio grille inside outer gold ring (MAT_GRILLE)
    q_gr_r = np.maximum(r_oval - 0.174, 0.0)
    q_gr_x = np.maximum(np.abs(ex - 0.158) - 0.010, 0.0)
    d_grille = np.sqrt(q_gr_r * q_gr_r + q_gr_x * q_gr_x) - 0.005
    d_grille = d_grille + 0.0055 * np.sin(ey * 58.0) * (r_oval < 0.168)

    # Bright cream bezel + gleaming gold center cap on outer cup
    q_md_r = np.maximum(r_circ - 0.068, 0.0)
    q_md_x = np.maximum(np.abs(ex - 0.175) - 0.009, 0.0)
    d_medallion = np.sqrt(q_md_r * q_md_r + q_md_x * q_md_x) - 0.007
    d_medallion_ring = np.sqrt((r_circ - 0.048) ** 2 + (ex - 0.186) ** 2) - 0.008

    # ------------------------------------------------------------------
    # 3. ASYMMETRIC LEFT/RIGHT STUDIO HARDWARE
    # ------------------------------------------------------------------
    boot_a = np.array([-0.625, -0.635, -0.025], dtype=np.float32)
    boot_b = np.array([-0.635, -0.725, -0.020], dtype=np.float32)
    d_boot = sd_capsule(px, py, pz, boot_a, boot_b, 0.028)

    pax = px[..., None] - CABLE_A[:, 0]
    pay = py[..., None] - CABLE_A[:, 1]
    paz = pz[..., None] - CABLE_A[:, 2]
    h_cab = np.clip(
        (pax * CABLE_BA[:, 0] + pay * CABLE_BA[:, 1] + paz * CABLE_BA[:, 2]) / CABLE_BABA,
        0.0,
        1.0,
    )
    cdx = pax - CABLE_BA[:, 0] * h_cab
    cdy = pay - CABLE_BA[:, 1] * h_cab
    cdz = paz - CABLE_BA[:, 2] * h_cab
    d_cable = np.min(np.sqrt(cdx * cdx + cdy * cdy + cdz * cdz), axis=-1) - 0.023

    d_plug_barrel = sd_capsule(px, py, pz, PLUG_BARREL_A, PLUG_BARREL_B, 0.034)
    d_plug_collar = sd_capsule(
        px,
        py,
        pz,
        np.array([-0.048, -0.832, 0.248], dtype=np.float32),
        np.array([-0.020, -0.820, 0.260], dtype=np.float32),
        0.038,
    )
    d_plug_tip = sd_capsule(px, py, pz, PLUG_TIP_A, PLUG_TIP_B, 0.016)

    # Right earcup rear metallic studio plate badge
    d_right_badge = sd_capsule(
        px,
        py,
        pz,
        np.array([0.785, -0.545, -0.185], dtype=np.float32),
        np.array([0.772, -0.615, -0.168], dtype=np.float32),
        0.018,
    )

    # Combine material groups
    d_mat_housing = d_shell
    d_mat_light = np.minimum(np.minimum(d_flange, d_clamp), np.minimum(d_baffle, np.minimum(d_medallion, d_plug_barrel)))
    d_mat_pad = np.minimum(d_earpad, d_headband_pad)
    d_mat_metal = np.minimum(np.minimum(np.minimum(d_hb_rails, d_hb_core), d_yoke), np.minimum(d_slider_rod, d_boot))
    d_mat_gold = np.minimum(
        np.minimum(d_outer_gold_ring, d_pivots),
        np.minimum(
            np.minimum(d_inner_gold, d_hb_piping),
            np.minimum(np.minimum(d_clamp_gold, d_medallion_ring), np.minimum(d_plug_collar, np.minimum(d_plug_tip, d_right_badge))),
        ),
    )
    d_mat_grille = d_grille
    d_mat_cable = d_cable

    d_total = np.minimum(
        np.minimum(np.minimum(d_mat_housing, d_mat_light), np.minimum(d_mat_pad, d_mat_metal)),
        np.minimum(np.minimum(d_mat_gold, d_mat_grille), d_mat_cable),
    )

    if not return_mat:
        return d_total

    mat = np.full(px.shape, MAT_HOUSING, dtype=np.int32)
    best = d_mat_housing.copy()

    for m_id, d_m in (
        (MAT_HOUSING_LIGHT, d_mat_light),
        (MAT_PAD, d_mat_pad),
        (MAT_METAL, d_mat_metal),
        (MAT_GOLD, d_mat_gold),
        (MAT_GRILLE, d_mat_grille),
        (MAT_CABLE, d_mat_cable),
    ):
        mask = d_m < best
        mat = np.where(mask, m_id, mat)
        best = np.where(mask, d_m, best)

    return d_total, mat


def render_frame_array(angle_rad: float, size: int = 512, ssaa: int = 2) -> tuple[np.ndarray, dict]:
    """
    Render a single 3D frame at `angle_rad` around the vertical Y axis using OBB slab culling.
    """
    res = size * ssaa

    # Fixed perspective studio camera (closer framing -> ~84% canvas fill)
    cam_pos = np.array([0.0, 0.04, 3.18], dtype=np.float32)
    target = np.array([0.0, -0.085, 0.0], dtype=np.float32)
    fov_scale = 0.352

    fwd = target - cam_pos
    fwd /= np.linalg.norm(fwd)
    world_up = np.array([0.0, 1.0, 0.0], dtype=np.float32)
    right = np.cross(fwd, world_up)
    right /= np.linalg.norm(right)
    up = np.cross(right, fwd)

    coords = (np.arange(res, dtype=np.float32) + 0.5) / res * 2.0 - 1.0
    ux, uy = np.meshgrid(coords, -coords)

    rdx = fwd[0] + ux * right[0] * fov_scale + uy * up[0] * fov_scale
    rdy = fwd[1] + ux * right[1] * fov_scale + uy * up[1] * fov_scale
    rdz = fwd[2] + ux * right[2] * fov_scale + uy * up[2] * fov_scale
    inv_len = 1.0 / np.sqrt(rdx * rdx + rdy * rdy + rdz * rdz)
    rdx *= inv_len
    rdy *= inv_len
    rdz *= inv_len

    # Rotate rays into object space (-angle_rad around Y)
    c_rot = math.cos(-angle_rad)
    s_rot = math.sin(-angle_rad)

    rox_obj = cam_pos[0] * c_rot + cam_pos[2] * s_rot
    roy_obj = cam_pos[1]
    roz_obj = -cam_pos[0] * s_rot + cam_pos[2] * c_rot

    rdx_flat = (rdx * c_rot + rdz * s_rot).ravel()
    rdy_flat = rdy.ravel()
    rdz_flat = (-rdx * s_rot + rdz * c_rot).ravel()

    # Exact Object-Space Bounding Box (OBB) slab intersection: culls ~70% of empty rays!
    bmin = np.array([-0.98, -1.02, -0.44], dtype=np.float32)
    bmax = np.array([0.98, 0.88, 0.44], dtype=np.float32)

    inv_dx = np.where(np.abs(rdx_flat) > 1e-7, 1.0 / rdx_flat, np.copysign(1e7, rdx_flat))
    inv_dy = np.where(np.abs(rdy_flat) > 1e-7, 1.0 / rdy_flat, np.copysign(1e7, rdy_flat))
    inv_dz = np.where(np.abs(rdz_flat) > 1e-7, 1.0 / rdz_flat, np.copysign(1e7, rdz_flat))

    tx1 = (bmin[0] - rox_obj) * inv_dx
    tx2 = (bmax[0] - rox_obj) * inv_dx
    ty1 = (bmin[1] - roy_obj) * inv_dy
    ty2 = (bmax[1] - roy_obj) * inv_dy
    tz1 = (bmin[2] - roz_obj) * inv_dz
    tz2 = (bmax[2] - roz_obj) * inv_dz

    t_enter = np.maximum(np.maximum(np.minimum(tx1, tx2), np.minimum(ty1, ty2)), np.minimum(tz1, tz2))
    t_exit = np.minimum(np.minimum(np.maximum(tx1, tx2), np.maximum(ty1, ty2)), np.maximum(tz1, tz2))

    box_hit = (t_exit >= np.maximum(t_enter, 0.0)) & (t_exit > 0.0)
    cand_idx = np.nonzero(box_hit)[0]
    t = np.maximum(t_enter[cand_idx], 0.0).astype(np.float32)
    t_max = t_exit[cand_idx].astype(np.float32)

    rdx_c = rdx_flat[cand_idx]
    rdy_c = rdy_flat[cand_idx]
    rdz_c = rdz_flat[cand_idx]

    hit_mask = np.zeros(len(cand_idx), dtype=bool)
    active = np.arange(len(cand_idx), dtype=np.int32)

    for _ in range(60):
        if active.size == 0:
            break
        ta = t[active]
        px = rox_obj + rdx_c[active] * ta
        py = roy_obj + rdy_c[active] * ta
        pz = roz_obj + rdz_c[active] * ta

        d = evaluate_sdf(px, py, pz, return_mat=False)
        newly_hit = d < 0.0012
        if np.any(newly_hit):
            hit_mask[active[newly_hit]] = True

        t[active] = ta + d * 0.93
        still_going = (~newly_hit) & (t[active] <= t_max[active])
        active = active[still_going]

    img_flat = np.zeros((res * res, 3), dtype=np.float32)
    hit_indices = np.nonzero(hit_mask)[0]

    telemetry = {
        "angle_deg": round(math.degrees(angle_rad), 2),
        "hit_fraction": round(float(len(hit_indices)) / float(res * res), 4),
    }

    if hit_indices.size > 0:
        th = t[hit_indices]
        rdx_h = rdx_c[hit_indices]
        rdy_h = rdy_c[hit_indices]
        rdz_h = rdz_c[hit_indices]

        hx = rox_obj + rdx_h * th
        hy = roy_obj + rdy_h * th
        hz = roz_obj + rdz_h * th

        _, mat_id = evaluate_sdf(hx, hy, hz, return_mat=True)

        # Tetrahedron surface normals
        eps = 0.0015
        d1 = evaluate_sdf(hx + eps, hy - eps, hz - eps)
        d2 = evaluate_sdf(hx - eps, hy - eps, hz + eps)
        d3 = evaluate_sdf(hx - eps, hy + eps, hz - eps)
        d4 = evaluate_sdf(hx + eps, hy + eps, hz + eps)

        nx_obj = d1 - d2 - d3 + d4
        ny_obj = -d1 - d2 + d3 + d4
        nz_obj = -d1 + d2 - d3 + d4
        n_inv = 1.0 / np.maximum(np.sqrt(nx_obj * nx_obj + ny_obj * ny_obj + nz_obj * nz_obj), 1e-8)
        nx_obj *= n_inv
        ny_obj *= n_inv
        nz_obj *= n_inv

        # Raymarched 3D Ambient Occlusion
        ao_acc = np.zeros_like(th)
        weight = 1.0
        for step_dist in (0.025, 0.068, 0.14):
            d_ao = evaluate_sdf(hx + nx_obj * step_dist, hy + ny_obj * step_dist, hz + nz_obj * step_dist)
            ao_acc += weight * np.maximum(step_dist - d_ao, 0.0)
            weight *= 0.55
        ao = np.clip(1.0 - 3.6 * ao_acc, 0.22, 1.0)

        # Rotate normal back to world space
        c_w = math.cos(angle_rad)
        s_w = math.sin(angle_rad)
        nx = nx_obj * c_w + nz_obj * s_w
        ny = ny_obj
        nz = -nx_obj * s_w + nz_obj * c_w

        pix_idx = cand_idx[hit_indices]
        vx = -rdx.ravel()[pix_idx]
        vy = -rdy.ravel()[pix_idx]
        vz = -rdz.ravel()[pix_idx]

        # Calibrated high-dynamic-range material palette for rich ASCII character gradation:
        # Pads ~[55-95], Shell ~[115-160], Flange/Metal ~[155-210], Gold ~[195-248]
        albedo = np.zeros((len(th), 3), dtype=np.float32)
        rough = np.full(len(th), 0.45, dtype=np.float32)
        spec_str = np.full(len(th), 0.35, dtype=np.float32)

        # MAT_HOUSING: Matte warm olive-taupe studio shell
        m = mat_id == MAT_HOUSING
        albedo[m] = (0.42, 0.43, 0.35)
        rough[m] = 0.52
        spec_str[m] = 0.28

        # MAT_HOUSING_LIGHT: Bright warm cream-stone mounting flange & clamp
        m = mat_id == MAT_HOUSING_LIGHT
        albedo[m] = (0.68, 0.65, 0.53)
        rough[m] = 0.36
        spec_str[m] = 0.42

        # MAT_PAD: Matte dark studio leather/velour cushion (distinct dark tonal range, still visible on #000)
        m = mat_id == MAT_PAD
        albedo[m] = (0.19, 0.20, 0.17)
        rough[m] = 0.78
        spec_str[m] = 0.12

        # MAT_METAL: Brushed steel headband rails & wishbone yoke
        m = mat_id == MAT_METAL
        albedo[m] = (0.66, 0.65, 0.56)
        rough[m] = 0.22
        spec_str[m] = 0.85

        # MAT_GOLD: Warm Gruvbox yellow-amber-gold studio rings, pivots & TRS tip
        m = mat_id == MAT_GOLD
        albedo[m] = (0.98, 0.77, 0.30)
        rough[m] = 0.18
        spec_str[m] = 0.95

        # MAT_GRILLE: Dark slotted studio acoustic grille
        m = mat_id == MAT_GRILLE
        albedo[m] = (0.23, 0.24, 0.20)
        rough[m] = 0.42
        spec_str[m] = 0.45

        # MAT_CABLE: Braided warm-gold studio audio cord
        m = mat_id == MAT_CABLE
        albedo[m] = (0.76, 0.64, 0.34)
        rough[m] = 0.36
        spec_str[m] = 0.50

        # 3-Point Studio Lighting in World Space
        k_dir = np.array([-0.52, 0.56, 0.64], dtype=np.float32)
        k_dir /= np.linalg.norm(k_dir)
        ndotl_k = np.maximum(nx * k_dir[0] + ny * k_dir[1] + nz * k_dir[2], 0.0)

        kl_obj_x = k_dir[0] * c_rot + k_dir[2] * s_rot
        kl_obj_y = k_dir[1]
        kl_obj_z = -k_dir[0] * s_rot + k_dir[2] * c_rot
        shadow = np.ones_like(th)
        for sh_t in (0.06, 0.16, 0.30):
            d_sh = evaluate_sdf(hx + kl_obj_x * sh_t, hy + kl_obj_y * sh_t, hz + kl_obj_z * sh_t)
            shadow = np.minimum(shadow, np.clip(6.0 * d_sh / sh_t, 0.28, 1.0))

        hk_x = k_dir[0] + vx
        hk_y = k_dir[1] + vy
        hk_z = k_dir[2] + vz
        hk_inv = 1.0 / np.maximum(np.sqrt(hk_x * hk_x + hk_y * hk_y + hk_z * hk_z), 1e-6)
        ndoth_k = np.maximum((nx * hk_x + ny * hk_y + nz * hk_z) * hk_inv, 0.0)
        shininess = np.clip(2.0 / (rough * rough * rough + 0.02), 6.0, 96.0)
        spec_k = (ndoth_k ** shininess) * spec_str * shadow

        f_dir = np.array([0.68, -0.18, 0.71], dtype=np.float32)
        f_dir /= np.linalg.norm(f_dir)
        ndotl_f = np.maximum(nx * f_dir[0] + ny * f_dir[1] + nz * f_dir[2], 0.0)

        r_dir = np.array([0.18, 0.66, -0.73], dtype=np.float32)
        r_dir /= np.linalg.norm(r_dir)
        ndotl_r = np.maximum(nx * r_dir[0] + ny * r_dir[1] + nz * r_dir[2], 0.0)
        ndotv = np.clip(nx * vx + ny * vy + nz * vz, 0.0, 1.0)
        fresnel_rim = ((1.0 - ndotv) ** 2.4) * (0.30 + 0.70 * ndotl_r)

        key_col = np.array([1.05, 1.00, 0.90], dtype=np.float32)
        fill_col = np.array([0.34, 0.36, 0.32], dtype=np.float32)
        amb_col = np.array([0.19, 0.20, 0.17], dtype=np.float32)
        rim_col = np.array([0.92, 0.82, 0.54], dtype=np.float32)

        diffuse = (
            amb_col * ao[:, None]
            + key_col * (ndotl_k * shadow * 0.92)[:, None]
            + fill_col * (ndotl_f * ao * 0.52)[:, None]
        )
        spec_col = np.where((mat_id == MAT_GOLD)[:, None], np.array([1.0, 0.86, 0.45], dtype=np.float32), np.array([1.0, 0.97, 0.88], dtype=np.float32))
        color = albedo * diffuse + spec_col * spec_k[:, None] * 0.55 + rim_col * (fresnel_rim * ao * 0.42)[:, None]

        color = color / (1.0 + 0.16 * color)
        color = np.clip(color, 0.0, 1.0) ** (1.0 / 2.15)
        img_flat[pix_idx] = color

        wx = hx * c_w + hz * s_w
        wz = -hx * s_w + hz * c_w
        telemetry["depth_min"] = round(float(th.min()), 3)
        telemetry["depth_max"] = round(float(th.max()), 3)
        telemetry["world_x_span"] = round(float(wx.max() - wx.min()), 3)
        telemetry["world_z_front"] = round(float(wz.max()), 3)

    img_hi = img_flat.reshape((res, res, 3))
    if ssaa > 1:
        img_lo = img_hi.reshape((size, ssaa, size, ssaa, 3)).mean(axis=(1, 3))
    else:
        img_lo = img_hi

    rgb_u8 = np.clip(np.rint(img_lo * 255.0), 0, 255).astype(np.uint8)
    return rgb_u8, telemetry


def _worker_render_frame(args: tuple[int, int, int, int, str]) -> dict:
    frame_idx, total_frames, size, ssaa, out_path = args
    angle = (2.0 * math.pi * frame_idx) / float(total_frames)
    rgb, telemetry = render_frame_array(angle, size=size, ssaa=ssaa)
    Image.fromarray(rgb, mode="RGB").save(out_path, format="PNG", compress_level=3)
    telemetry["frame"] = frame_idx
    return telemetry


def run_test_views(out_dir: Path, size: int = 512, ssaa: int = 2, workers: int = 6) -> None:
    test_dir = out_dir / "test-views"
    test_dir.mkdir(parents=True, exist_ok=True)
    angles_deg = [0, 45, 90, 135, 180, 270]
    labels = [
        "0 deg - FRONT",
        "45 deg - FRONT-LEFT 3/4",
        "90 deg - LEFT PROFILE (w/ cable)",
        "135 deg - REAR-LEFT 3/4",
        "180 deg - BACK (rear vents)",
        "270 deg - RIGHT PROFILE (cordless)",
    ]

    t0 = time.perf_counter()
    tasks = [
        (deg, size, ssaa, str(test_dir / f"view-{deg:03d}.png"))
        for deg in angles_deg
    ]
    tiles = []
    stats = []
    with concurrent.futures.ProcessPoolExecutor(max_workers=min(workers, len(angles_deg))) as pool:
        futs = [pool.submit(render_frame_array, math.radians(deg), size, ssaa) for deg in angles_deg]
        for (deg, label), fut in zip(zip(angles_deg, labels), futs):
            rgb, tel = fut.result()
            tel["label"] = label
            stats.append(tel)
            im = Image.fromarray(rgb, mode="RGB")
            im.save(test_dir / f"view-{deg:03d}.png")
            annotated = im.copy()
            draw = ImageDraw.Draw(annotated)
            draw.text((14, 14), label, fill=(250, 189, 47))
            tiles.append(annotated)

    sheet = Image.new("RGB", (size * 3, size * 2), (0, 0, 0))
    for idx, tile in enumerate(tiles):
        sheet.paste(tile, ((idx % 3) * size, (idx // 3) * size))
    sheet_path = out_dir / "preview-3d-views.png"
    sheet.save(sheet_path)
    dt = time.perf_counter() - t0
    print(json.dumps({"test_render_seconds": round(dt, 2), "preview_sheet": str(sheet_path), "views": stats}, indent=2))


def run_full_sequence(out_dir: Path, total_frames: int = 96, fps: int = 24, size: int = 512, ssaa: int = 2, workers: int = 10) -> None:
    frames_dir = out_dir / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)

    tasks = [
        (i, total_frames, size, ssaa, str(frames_dir / f"frame-{i:03d}.png"))
        for i in range(total_frames)
    ]

    t0 = time.perf_counter()
    telemetries = []
    with concurrent.futures.ProcessPoolExecutor(max_workers=workers) as pool:
        for tel in pool.map(_worker_render_frame, tasks, chunksize=2):
            telemetries.append(tel)
    t_render = time.perf_counter() - t0

    mp4_path = out_dir / "video-fuente.mp4"
    ffmpeg_cmd = [
        "ffmpeg",
        "-y",
        "-framerate",
        str(fps),
        "-i",
        str(frames_dir / "frame-%03d.png"),
        "-frames:v",
        str(total_frames),
        "-c:v",
        "libx264",
        "-preset",
        "slow",
        "-crf",
        "15",
        "-pix_fmt",
        "yuv420p",
        "-an",
        "-movflags",
        "+faststart",
        str(mp4_path),
    ]
    subprocess.run(ffmpeg_cmd, check=True, capture_output=True, text=True)

    report = {
        "video": str(mp4_path),
        "frames_dir": str(frames_dir),
        "total_frames": total_frames,
        "fps": fps,
        "duration_seconds": round(total_frames / fps, 3),
        "resolution": f"{size}x{size}",
        "ssaa": ssaa,
        "render_seconds": round(t_render, 2),
        "key_angles": [t for t in telemetries if t["frame"] in (0, 24, 48, 72, 95)],
    }
    (out_dir / "source-render-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description="Render 3D rotating studio headphones video source.")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--mode", choices=["test", "full"], default="test")
    parser.add_argument("--frames", type=int, default=96)
    parser.add_argument("--fps", type=int, default=24)
    parser.add_argument("--size", type=int, default=512)
    parser.add_argument("--ssaa", type=int, default=2)
    parser.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 4) - 2))
    args = parser.parse_args()

    if args.mode == "test":
        run_test_views(args.out, size=args.size, ssaa=args.ssaa, workers=args.workers)
    else:
        run_full_sequence(
            args.out,
            total_frames=args.frames,
            fps=args.fps,
            size=args.size,
            ssaa=args.ssaa,
            workers=args.workers,
        )


if __name__ == "__main__":
    main()