package com.projectprobe;

import java.util.List;

record ListPage<T>(List<T> items, boolean hasMore, long total, int offset, int limit) {}
