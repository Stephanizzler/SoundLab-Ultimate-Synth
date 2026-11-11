# The SoundLab audio core as a header-only C++ library, for plug-ins and apps
# (JUCE or iPlug2 projects add this directory), plus a command-line check.
cmake_minimum_required(VERSION 3.16)
project(soundlab_core CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(soundlab_core INTERFACE)
target_include_directories(soundlab_core INTERFACE include)
# No fused multiply-add contraction, so native builds round like the browser engine.
target_compile_options(soundlab_core INTERFACE $<$<CXX_COMPILER_ID:GNU,Clang,AppleClang>:-ffp-contract=off>)

add_executable(soundlab_render test/render.cpp)
target_link_libraries(soundlab_render PRIVATE soundlab_core)
