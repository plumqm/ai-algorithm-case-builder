#include <bits/stdc++.h>
using namespace std;

static int get_index(int argc, char **argv) {
    if (argc >= 2) return atoi(argv[1]);
    return 1;
}

static uint64_t make_seed(int idx) {
    uint64_t now = chrono::high_resolution_clock::now().time_since_epoch().count();
    uint64_t mix = static_cast<uint64_t>(idx) * 0x9e3779b97f4a7c15ULL;
    return now ^ (mix + (now << 1));
}

int main(int argc, char **argv) {
    int idx = get_index(argc, argv);
    mt19937 rng(static_cast<unsigned>(make_seed(idx)));

    // Default template: A + B.
    // The AI UI rewrites this file according to the Markdown problem statement.
    int a = idx;
    int b = idx * 2;
    if (idx == 1) {
        a = 1;
        b = 2;
    } else if (idx == 2) {
        a = 0;
        b = 0;
    } else {
        uniform_int_distribution<int> dist(0, 1000);
        a = dist(rng);
        b = dist(rng);
    }

    cout << a << ' ' << b << '\n';
    return 0;
}
